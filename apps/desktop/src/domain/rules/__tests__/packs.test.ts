import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assemblePack, loadBundledPacks, parsePackYaml, parseRuleYaml, selectPacks, validateBundle } from '../packs'
import { validateRuleMeta, evaluate, countFindings } from '../engine'
import { getSourceRegistry } from '../packs/registry'
import { allPredicates as predicates } from './predicates'
import { DEFAULT_APP_SETTINGS, MODULE_IDS, type CampFacts, type CategoryMapping, type RulePack } from '@/domain/types'
import { makeCtx, MAPPING, FactsBuilder } from './factory'

const EXPECTED_IDS = [
  'JS-CAMP-01', 'JS-CAMP-02', 'JS-DAY-01', 'JS-DAY-02', 'JS-DAY-03', 'JS-DAY-04', 'JS-DAY-05', 'JS-DL-01', 'JS-DL-02', 'JS-DL-03',
  'JS-LL-01', 'JS-STAFF-01', 'JS-FREE-01', 'JS-BWZ-27',
  'CMP-ACT-01', 'CMP-ACT-02', 'CMP-ACT-03', 'CMP-LA-01', 'CMP-DAY-01', 'CMP-CAMP-01', 'CMP-MD-01', 'CMP-NDS-01', 'CMP-NDS-02', 'CMP-NDS-03', 'CMP-PROG-01', 'CMP-CON-01', 'CMP-CON-02', 'CMP-CON-03', 'CMP-CON-04', 'CMP-CON-05', 'CMP-CON-06', 'CMP-CON-07', 'CMP-CON-08', 'CMP-CON-09', 'CMP-CON-10',
  'SAFE-WATER-01', 'SAFE-MTN-01', 'SAFE-MTN-02', 'SAFE-MTN-03', 'SAFE-ROPE-01', 'SAFE-NIGHT-01', 'SAFE-WX-01', 'SAFE-DOC-01',
  'BP-REST-01', 'BP-SLEEP-01', 'BP-WOLF-01', 'BP-WATER-01', 'BP-VAR-01',
]
const PBS_IDS = ['BP-REST-01', 'BP-SLEEP-01', 'BP-WOLF-01', 'BP-WATER-01', 'CMP-PROG-01']

const packs = loadBundledPacks()
const allRules = packs.flatMap((p) => p.rules)
const byId = Object.fromEntries(allRules.map((r) => [r.meta.id, r.meta]))

describe('bundled packs (rules v2)', () => {
  it('are coco-js-lst and coco-pbs with all rules', () => {
    expect(packs.map((p) => p.id)).toEqual(['coco-js-lst', 'coco-pbs'])
    expect(packs.map((p) => p.version)).toEqual(['2026.2.0', '2026.2.0'])
    expect(allRules.map((r) => r.meta.id).sort()).toEqual([...EXPECTED_IDS].sort())
    expect(packs[1].rules.map((r) => r.meta.id).sort()).toEqual([...PBS_IDS].sort())
  })

  it('define all modules of §2.2 once', () => {
    expect(packs.flatMap((p) => p.modules ?? []).map((m) => m.id).sort()).toEqual([...MODULE_IDS].sort())
  })

  it('accept the old pack id coco-basis through aliases', () => {
    expect(selectPacks(packs, ['coco-basis']).map((p) => p.id)).toEqual(['coco-js-lst', 'coco-pbs'])
    expect(selectPacks(packs, ['coco-pbs']).map((p) => p.id)).toEqual(['coco-pbs'])
    expect(selectPacks(packs, [])).toHaveLength(2)
  })

  it('have globally unique rule ids and formerIds; every reference resolves', () => {
    expect(new Set(allRules.map((r) => r.meta.id)).size).toBe(allRules.length)
    expect(validateBundle(packs)).toEqual([])
  })

  it('has valid metadata, a resolvable source with URL and German texts for every rule', () => {
    const reg = getSourceRegistry()
    for (const { meta } of allRules) {
      expect(validateRuleMeta(meta), meta.id).toEqual([])
      expect(meta.sources.length, meta.id).toBeGreaterThan(0)
      expect(meta.sources.every((s) => reg.get(s.key)), meta.id).toBe(true)
      expect(meta.source.url, meta.id).toMatch(/^https:\/\//)
      expect(meta.message, meta.id).toMatch(/\S/)
      expect(meta.group, meta.id).toBe(meta.module)
    }
  })

  it('must ⇒ verified (loader and validateRuleMeta)', () => {
    for (const { meta } of allRules) if (meta.severity === 'must') expect(meta.confidence, meta.id).toBe('verified')
    expect(validateRuleMeta({ ...byId['JS-DAY-01'], confidence: 'heuristic' })).toEqual([expect.stringMatching(/must.*verified/)])
  })

  it('keeps today’s severities/confidences (behaviour-preserving migration)', () => {
    expect(byId['JS-STAFF-01']).toMatchObject({ severity: 'should', confidence: 'conflict' })
    expect(byId['JS-FREE-01']).toMatchObject({ severity: 'should', confidence: 'conflict' })
    expect(byId['JS-BWZ-27']).toMatchObject({ severity: 'hint', confidence: 'unverified', validFrom: '2027-01-01' })
    expect(byId['JS-DAY-01'].severity).toBe('must')
    expect(byId['JS-DAY-05'].severity).toBe('should')
    expect(byId['CMP-CAMP-01'].severity).toBe('hint')
    expect(byId['SAFE-NIGHT-01'].severity).toBe('hint')
    expect(packs[1].rules.every((r) => r.meta.severity === 'hint')).toBe(true)
  })

  it('assigns the §4 modules', () => {
    expect(byId['JS-CAMP-01'].module).toBe('lst')
    expect(byId['JS-CAMP-02'].module).toBe('js')
    expect(byId['CMP-DAY-01'].module).toBe('lst-lager')
    expect(byId['BP-VAR-01'].module).toBe('lst')
    expect(byId['CMP-PROG-01'].module).toBe('pbs')
  })

  it('has a predicate for every YAML and vice versa', () => {
    expect(Object.keys(predicates).sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it('every messageVariant placeholder style is valid (no empty {})', () => {
    for (const { meta } of allRules) {
      expect(meta.message).not.toMatch(/\{\s*\}/)
      for (const v of Object.values(meta.messageVariants ?? {})) expect(v).not.toMatch(/\{\s*\}/)
    }
  })
})

describe('parseRuleYaml / parsePackYaml / assemblePack', () => {
  const yaml = `id: X-TEST-01
version: 1.0.0
module: js
title: T
description: D
message: "M {a}"
severity: should
confidence: heuristic
scope: camp
validFrom: 2026-01-01
sources:
  - key: WEB-L
    page: "«Lagerdauer»"
`
  it('parses dates as strings, status defaults to active, group = module', () => {
    expect(parseRuleYaml(yaml)).toMatchObject({ id: 'X-TEST-01', validFrom: '2026-01-01', version: '1.0.0', status: 'active', group: 'js' })
    expect(parseRuleYaml(yaml).source.url).toBe('https://www.jugendundsport.ch/de/lager')
  })
  it('rejects must without verified', () => {
    expect(() => parseRuleYaml(yaml.replace('should', 'must'))).toThrow(/must/)
  })
  it('rejects a missing or unknown source', () => {
    expect(() => parseRuleYaml(yaml.replace(/sources:[\s\S]*/, ''))).toThrow(/sources/)
    expect(() => parseRuleYaml(yaml.replace('WEB-L', 'NOPE'))).toThrow(/NOPE/)
  })
  it('rejects an unknown module', () => {
    expect(() => parseRuleYaml(yaml.replace('module: js', 'module: safety'))).toThrow(/module/)
  })
  it('accepts the legacy source {title,url} and old source keys', () => {
    const legacy = yaml.replace(/sources:[\s\S]*/, 'source:\n  title: J+S\n  url: https://www.jugendundsport.ch/de/leitfaden-coach\n')
    expect(parseRuleYaml(legacy).sources).toEqual([{ key: 'WEB-C', page: '' }])
    expect(parseRuleYaml(yaml.replace('WEB-L', 'L')).source.url).toBe('https://www.jugendundsport.ch/de/lager')
  })
  it('pack.yaml rejects unknown trigger keys', () => {
    const pack = 'id: p\nname: P\nversion: 1\nmodules:\n  - id: lst-berg\n    title: Berg\n    default: auto\n    suggestWhen:\n      - { weather: rain }\n'
    expect(() => parsePackYaml(pack)).toThrow(/weather/)
    expect(parsePackYaml(pack.replace('{ weather: rain }', '{ keywordSet: MOUNTAIN, minActivities: 2 }')).modules?.[0].suggestWhen).toEqual([
      { keywordSet: 'MOUNTAIN', minActivities: 2 },
    ])
  })
  it('assemblePack requires matching predicates and existing modules', () => {
    const meta = parseRuleYaml(yaml)
    const base = { id: 'p', name: 'P', version: '1', description: '' }
    expect(assemblePack(base, [meta], { 'X-TEST-01': () => [] }).rules).toHaveLength(1)
    expect(() => assemblePack(base, [meta], {})).toThrow(/Prädikat/)
    expect(() => assemblePack(base, [meta], { 'X-TEST-01': () => [], 'Y-OTHER-01': () => [] })).toThrow(/Y-OTHER-01/)
    expect(() => assemblePack({ ...base, modules: [] }, [meta], { 'X-TEST-01': () => [] })).toThrow(/Modul js/)
  })
  it('validateBundle rejects a formerId equal to a live id and unknown params', () => {
    const meta = { ...parseRuleYaml(yaml), formerIds: ['JS-DAY-01'], params: ['js.nope'] }
    const extra: RulePack = { id: 'x', name: 'X', version: '1', description: '', rules: [{ meta, check: () => [] }] }
    const errors = validateBundle([...packs, extra])
    expect(errors.some((e) => /formerId JS-DAY-01/.test(e))).toBe(true)
    expect(errors.some((e) => /js\.nope/.test(e))).toBe(true)
  })
})

describe('end to end', () => {
  it('a clean synthetic camp has no findings from the mapping-based J+S rules', () => {
    const b = new FactsBuilder({ days: 5 })
    for (let d = 1; d <= 5; d++) b.validDay(d, d % 2 ? 'LS' : 'LA')
    const mapping: CategoryMapping = { ...MAPPING, entries: { LS: 'LS', LA: 'LA' } }
    for (const a of b.facts.activities) a.categoryIri = a.categoryIri === 'LS' ? 'LS' : 'LA'
    const findings = evaluate(loadBundledPacks(), makeCtx(b.facts, { mapping }))
    const dayRules = findings.filter((f) => ['JS-DAY-01', 'JS-DAY-02', 'JS-DAY-03', 'JS-DAY-04', 'JS-CAMP-01', 'JS-FREE-01'].includes(f.ruleId))
    expect(dayRules).toEqual([])
    expect(findings.every((f) => ['coco-js-lst', 'coco-pbs'].includes(f.packId ?? '') && f.source && f.module && f.sources?.length)).toBe(true)
  })
})

// Smoke test over the dev-camp CampFacts fixture.
const FIXTURE = fileURLToPath(new URL('../../../__tests__/fixtures/camps/auf-in-die-berge.facts.json', import.meta.url))
describe.skipIf(!existsSync(FIXTURE))('smoke: Auf in die Berge', () => {
  const facts = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as CampFacts
  const guessed = (): CategoryMapping => {
    const entries: CategoryMapping['entries'] = {}
    for (const c of facts.categories) {
      const key = `${c.short} ${c.name}`.toLowerCase()
      entries[c.iri] = /\bls\b|sport/.test(key) ? 'LS' : /\bla\b|aktivit/.test(key) ? 'LA' : /essen|\bes\b/.test(key) ? 'ES' : 'NONE'
    }
    return { campIri: facts.camp.iri, entries, confirmed: true, confirmedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }
  }

  it('evaluates all rules without throwing, deterministically, with and without mapping', () => {
    const packs = loadBundledPacks()
    for (const mapping of [null, guessed()]) {
      const ctx = makeCtx(facts, { mapping, settings: DEFAULT_APP_SETTINGS, now: new Date('2030-01-01T00:00:00Z') })
      const a = evaluate(packs, ctx)
      const b = evaluate(packs, ctx)
      expect(a).toEqual(b)
      expect(a.length).toBeGreaterThan(0)
      expect(new Set(a.map((f) => f.id)).size).toBe(a.length)
      for (const f of a) {
        expect(f.message, f.id).not.toMatch(/\{\w+\}/)
        if (f.confidence === 'unverified' || f.confidence === 'conflict') expect(f.severity).not.toBe('must')
      }
      const c = countFindings(a)
      expect(c.must + c.should + c.hint).toBe(a.length)
    }
  })
})
