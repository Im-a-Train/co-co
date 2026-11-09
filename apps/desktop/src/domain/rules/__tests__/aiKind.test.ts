import { describe, expect, it } from 'vitest'
import { evaluate, validateRuleMeta } from '../engine'
import { loadBundledPacks, parseRuleYaml } from '../packs'
import { aiGuidanceRules, guidanceText } from '../aiGuidance'
import type { Rule, RuleMeta, RulePack } from '@/domain/types'
import { FactsBuilder, makeCtx, CAT_LS } from './factory'

/** Keyword rules that stay hard: they feed J+S day counting, Sicherheitsbereich detection or a binding requirement. */
const HARD_KEYWORD_RULES = new Set([
  'CMP-ACT-03',
  'JS-DAY-05',
  'JS-EXCL-01',
  'JS-PROG-02',
  'LST-SB-01',
  'LST-ANG-01',
  'LST-WASSER-04',
  // Counts the coach input slrgCount (INPUT_RULES in components/camps/inputsForm.ts); keywords only detect water activities.
  'BP-WATER-01',
])

const packs = loadBundledPacks()
const allRules = packs.flatMap((p) => p.rules)

describe('rule kind', () => {
  it('every rule reading keywords is kind ai or in HARD_KEYWORD_RULES', () => {
    for (const { meta } of allRules) {
      if (!meta.keywords?.length) continue
      const ok = meta.kind === 'ai' || HARD_KEYWORD_RULES.has(meta.id)
      expect(ok, `${meta.id} liest Stichwörter, ist aber weder kind: ai noch erlaubt-hart`).toBe(true)
    }
  })

  it('the hard allowlist only names existing hard rules', () => {
    for (const id of HARD_KEYWORD_RULES) expect(allRules.find((r) => r.meta.id === id)?.meta.kind, id).toBe('hard')
  })

  it('no ai rule is must; kind defaults to hard in YAML', () => {
    for (const { meta } of allRules) if (meta.kind === 'ai') expect(meta.severity).not.toBe('must')
    expect(allRules.filter((r) => r.meta.kind === 'ai').length).toBeGreaterThan(30)
    expect(allRules.find((r) => r.meta.id === 'JS-DAY-01')?.meta.kind).toBe('hard')
  })

  it('validation rejects unknown kinds and ai + must', () => {
    const base = allRules.find((r) => r.meta.id === 'LST-ACT-01')!.meta
    expect(validateRuleMeta(base)).toEqual([])
    expect(validateRuleMeta({ ...base, kind: 'weird' as never }).join()).toMatch(/kind ungültig/)
    expect(validateRuleMeta({ ...base, severity: 'must', confidence: 'verified' }).join()).toMatch(/KI-Regeln/)
  })

  it('parseRuleYaml defaults kind to hard', () => {
    const yaml = `id: T-X-01\nversion: 1\nmodule: js\ntitle: t\ndescription: d\nmessage: m\nseverity: hint\nconfidence: heuristic\nscope: camp\nsources:\n  - key: LEITFADEN\n    page: x\n`
    expect(parseRuleYaml(yaml).kind).toBe('hard')
    expect(parseRuleYaml(yaml + 'kind: ai\n').kind).toBe('ai')
  })

  it('engine produces no finding for ai rules', () => {
    const base = allRules.find((r) => r.meta.id === 'LST-ACT-01')!.meta
    const mk = (kind: RuleMeta['kind']): RulePack => ({
      id: 'x',
      name: 'x',
      version: '1',
      description: '',
      validFrom: '2026-01-01',
      rules: [{ meta: { ...base, id: 'T-AI-01', kind, keywords: [], module: 'js' }, check: (ctx) => [{ targets: [ctx.facts.camp.iri] }] } as Rule],
    })
    const b = new FactsBuilder({ start: '2031-07-12' })
    b.activity('Film', CAT_LS)
    const ctx = makeCtx(b.facts)
    expect(evaluate([mk('hard')], ctx).map((f) => f.ruleId)).toEqual(['T-AI-01'])
    expect(evaluate([mk('ai')], ctx)).toEqual([])
  })
})

describe('aiGuidance', () => {
  it('includes ai and hard rules, respects disabled ids, modules off and validity', () => {
    const all = aiGuidanceRules(packs, { campStart: '2031-07-12' })
    expect(all.some((r) => r.kind === 'ai')).toBe(true)
    expect(all.some((r) => r.kind === 'hard')).toBe(true)
    const noOne = aiGuidanceRules(packs, { campStart: '2031-07-12', disabledRuleIds: new Set(['LST-ACT-01']) })
    expect(noOne.find((r) => r.id === 'LST-ACT-01')).toBeUndefined()
    const noWasser = aiGuidanceRules(packs, { campStart: '2031-07-12', moduleStates: { 'lst-wasser': 'off' } })
    expect(noWasser.some((r) => r.module === 'lst-wasser')).toBe(false)
    expect(aiGuidanceRules(packs, { campStart: '2001-01-01' })).toEqual([])
  })

  it('lists ai rules before hard rules so a cut never drops guidance', () => {
    const all = aiGuidanceRules(packs, { campStart: '2031-07-12' })
    const firstHard = all.findIndex((r) => r.kind === 'hard')
    expect(firstHard).toBeGreaterThan(0)
    expect(all.slice(firstHard).every((r) => r.kind === 'hard')).toBe(true)
  })

  it('guidanceText is compact, German and capped', () => {
    const rules = aiGuidanceRules(packs, { campStart: '2031-07-12' })
    const text = guidanceText(rules, 3000)
    expect(text.length).toBeLessThanOrEqual(3000)
    expect(text).toContain('LST-')
    expect(text).toContain('Quellen:')
    expect(guidanceText(rules, 10).length).toBeLessThanOrEqual(10)
  })
})
