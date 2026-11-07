import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assemblePack, loadBundledPacks, parseRuleYaml } from '../packs'
import { validateRuleMeta, evaluate, countFindings } from '../engine'
import { predicates } from '../packs/basis/predicates'
import { DEFAULT_APP_SETTINGS, type CampFacts, type CategoryMapping } from '@/domain/types'
import { makeCtx, MAPPING, FactsBuilder } from './factory'

const SOURCES = [
  'https://www.jugendundsport.ch/de/lager',
  'https://www.jugendundsport.ch/de/leitfaden-coach',
  'https://www.jugendundsport.ch/de/lagersport-trekking',
  'https://hering.scout.ch/de',
]

const EXPECTED_IDS = [
  'JS-CAMP-01', 'JS-CAMP-02', 'JS-DAY-01', 'JS-DAY-02', 'JS-DAY-03', 'JS-DAY-04', 'JS-DAY-05', 'JS-DL-01', 'JS-DL-02', 'JS-DL-03',
  'JS-LL-01', 'JS-STAFF-01', 'JS-FREE-01', 'JS-BWZ-27',
  'CMP-ACT-01', 'CMP-ACT-02', 'CMP-ACT-03', 'CMP-LA-01', 'CMP-DAY-01', 'CMP-CAMP-01', 'CMP-PROG-01',
  'SAFE-WATER-01', 'SAFE-MTN-01', 'SAFE-MTN-02', 'SAFE-ROPE-01', 'SAFE-NIGHT-01', 'SAFE-WX-01', 'SAFE-DOC-01',
  'BP-REST-01', 'BP-SLEEP-01', 'BP-WOLF-01', 'BP-WATER-01', 'BP-VAR-01',
]

describe('bundled basic pack', () => {
  const [pack] = loadBundledPacks()

  it('is "co-co Basis 2026.1" with all specified rules', () => {
    expect(loadBundledPacks()).toHaveLength(1)
    expect(pack.name).toBe('co-co Basis 2026.1')
    expect(pack.rules.map((r) => r.meta.id).sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it('has valid metadata, official sources and German texts for every rule', () => {
    for (const { meta } of pack.rules) {
      expect(validateRuleMeta(meta), meta.id).toEqual([])
      expect(SOURCES, meta.id).toContain(meta.source.url)
      expect(meta.message, meta.id).toMatch(/\S/)
      if (meta.confidence === 'unverified' || meta.confidence === 'conflict') expect(meta.severity, meta.id).not.toBe('must')
    }
  })

  it('has the severities/confidences required by the spec', () => {
    const m = Object.fromEntries(pack.rules.map((r) => [r.meta.id, r.meta]))
    expect(m['JS-STAFF-01']).toMatchObject({ severity: 'should', confidence: 'conflict' })
    expect(m['JS-FREE-01']).toMatchObject({ severity: 'should', confidence: 'conflict' })
    expect(m['JS-BWZ-27']).toMatchObject({ severity: 'hint', confidence: 'unverified', validFrom: '2027-01-01' })
    expect(m['JS-DAY-01'].severity).toBe('must')
    expect(m['JS-DAY-05'].severity).toBe('should')
    expect(m['CMP-CAMP-01'].severity).toBe('hint')
    expect(m['CMP-PROG-01'].severity).toBe('hint')
    expect(m['SAFE-NIGHT-01'].severity).toBe('hint')
    expect(pack.rules.filter((r) => r.meta.group === 'best-practice').every((r) => r.meta.severity === 'hint')).toBe(true)
  })

  it('message placeholders are limited to the keys the predicates provide (smoke: no unfilled {..} for the happy hit)', () => {
    for (const { meta } of pack.rules) expect(meta.message).not.toMatch(/\{\s*\}/)
  })

  it('has a predicate for every YAML and vice versa', () => {
    expect(Object.keys(predicates).sort()).toEqual([...EXPECTED_IDS].sort())
  })
})

describe('parseRuleYaml / assemblePack', () => {
  const yaml = `id: X-TEST-01
version: 1.0.0
group: js
title: T
description: D
message: "M {a}"
severity: should
confidence: heuristic
scope: camp
validFrom: 2026-01-01
source:
  title: J+S
  url: https://www.jugendundsport.ch/de/lager
`
  it('parses dates as strings', () => {
    expect(parseRuleYaml(yaml)).toMatchObject({ id: 'X-TEST-01', validFrom: '2026-01-01', version: '1.0.0' })
  })
  it('rejects must + unverified', () => {
    expect(() => parseRuleYaml(yaml.replace('should', 'must').replace('heuristic', 'unverified'))).toThrow(/must/)
  })
  it('rejects a missing source', () => {
    expect(() => parseRuleYaml(yaml.replace(/source:[\s\S]*/, ''))).toThrow(/source/)
  })
  it('assemblePack requires matching predicates', () => {
    const meta = parseRuleYaml(yaml)
    const base = { id: 'p', name: 'P', version: '1', description: '' }
    expect(assemblePack(base, [meta], { 'X-TEST-01': () => [] }).rules).toHaveLength(1)
    expect(() => assemblePack(base, [meta], {})).toThrow(/Prädikat/)
    expect(() => assemblePack(base, [meta], { 'X-TEST-01': () => [], 'Y-OTHER-01': () => [] })).toThrow(/Y-OTHER-01/)
  })
})

describe('end to end', () => {
  it('a clean synthetic camp has no must findings from the mapping-based J+S rules', () => {
    const b = new FactsBuilder({ days: 5 })
    for (let d = 1; d <= 5; d++) b.validDay(d, d % 2 ? 'LS' : 'LA')
    const mapping: CategoryMapping = { ...MAPPING, entries: { LS: 'LS', LA: 'LA' } }
    for (const a of b.facts.activities) a.categoryIri = a.categoryIri === 'LS' ? 'LS' : 'LA'
    const findings = evaluate(loadBundledPacks(), makeCtx(b.facts, { mapping }))
    const dayRules = findings.filter((f) => ['JS-DAY-01', 'JS-DAY-02', 'JS-DAY-03', 'JS-DAY-04', 'JS-CAMP-01', 'JS-FREE-01'].includes(f.ruleId))
    expect(dayRules).toEqual([])
    expect(findings.every((f) => f.packId === 'coco-basis' && f.source)).toBe(true)
  })
})

// Smoke test over the dev camp facts written by the data builder.
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
