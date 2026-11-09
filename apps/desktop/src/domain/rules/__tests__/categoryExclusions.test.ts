import { describe, expect, it } from 'vitest'
import { filterExcludedFindings } from '../categoryExclusions'
import {
  EMPTY_RULE_STATE,
  categoryExclusionsForCamp,
  excludeCategory,
  includeCategory,
  isCategoryExcluded,
  normalizeRuleState,
} from '../ruleState'
import type { Finding } from '@/domain/types'
import { CAMP, CAT_LA, CAT_LS, FactsBuilder } from './factory'

const finding = (ruleId: string, scope: Finding['scope'], targets: string[]): Finding => ({
  id: `${ruleId}:${targets.join('|')}`,
  ruleId,
  ruleVersion: '1',
  packId: null,
  severity: 'should',
  confidence: 'verified',
  title: 't',
  message: 'm',
  scope,
  targets,
  evidence: [],
  source: null,
  origin: 'rule',
  tags: [],
  override: null,
})

describe('ruleState category exclusions', () => {
  it('normalizes old states without the field', () => {
    expect(normalizeRuleState({ disabled: [], muted: [] }).excludedCategories).toEqual([])
    expect(EMPTY_RULE_STATE.excludedCategories).toEqual([])
    expect(normalizeRuleState({ excludedCategories: [{ campIri: 'c', categoryIri: 'k', ruleId: null }, { bad: 1 }] }).excludedCategories).toHaveLength(1)
  })
  it('excludes, dedupes and includes', () => {
    const s = excludeCategory(excludeCategory(EMPTY_RULE_STATE, 'c', 'k', null), 'c', 'k', null)
    expect(s.excludedCategories).toHaveLength(1)
    expect(includeCategory(s, 'c', 'k', 'R').excludedCategories).toHaveLength(1)
    expect(includeCategory(s, 'c', 'k', null).excludedCategories).toHaveLength(0)
  })
  it('null rule matches all rules, rule entry only its rule, per camp', () => {
    const all = excludeCategory(EMPTY_RULE_STATE, 'c', 'k', null)
    expect(isCategoryExcluded(all, 'c', 'k', 'R1')).toBe(true)
    expect(isCategoryExcluded(all, 'other', 'k', 'R1')).toBe(false)
    const one = excludeCategory(EMPTY_RULE_STATE, 'c', 'k', 'R1')
    expect(isCategoryExcluded(one, 'c', 'k', 'R1')).toBe(true)
    expect(isCategoryExcluded(one, 'c', 'k', 'R2')).toBe(false)
    expect(categoryExclusionsForCamp(one, 'c')).toHaveLength(1)
    expect(categoryExclusionsForCamp(one, 'x')).toHaveLength(0)
  })
  it('an exclusion stored under a former rule id still applies to its successor', () => {
    const old = excludeCategory(EMPTY_RULE_STATE, 'c', 'k', 'SAFE-MTN-03')
    expect(isCategoryExcluded(old, 'c', 'k', 'LST-SB-03', ['SAFE-MTN-03'])).toBe(true)
    expect(isCategoryExcluded(old, 'c', 'k', 'LST-SB-03')).toBe(false)
  })
})

describe('filterExcludedFindings', () => {
  const b = new FactsBuilder()
  const ls = b.activity('Spiel', CAT_LS)
  const la = b.activity('Lager', CAT_LA)
  const e = b.entry(la, 1, '09:00', '10:00')
  const facts = b.facts
  const fs = [
    finding('R1', 'activity', [ls.iri]),
    finding('R2', 'activity', [ls.iri]),
    finding('R1', 'scheduleEntry', [e.iri]),
    finding('R1', 'camp', [CAMP]),
    finding('R1', 'day', ['/api/days/d1']),
  ]

  it('keeps everything without exclusions', () => {
    const r = filterExcludedFindings(fs, facts, EMPTY_RULE_STATE, CAMP)
    expect(r.kept).toHaveLength(5)
    expect(r.excluded).toBe(0)
  })
  it('drops activity findings of a category for all rules, never camp/day ones', () => {
    const r = filterExcludedFindings(fs, facts, excludeCategory(EMPTY_RULE_STATE, CAMP, CAT_LS, null), CAMP)
    expect(r.excluded).toBe(2)
    expect(r.kept.map((f) => f.id)).not.toContain(`R1:${ls.iri}`)
    expect(r.kept.filter((f) => f.scope === 'camp' || f.scope === 'day')).toHaveLength(2)
  })
  it('drops only the given rule for per-rule exclusion and resolves schedule entries', () => {
    const s = excludeCategory(excludeCategory(EMPTY_RULE_STATE, CAMP, CAT_LS, 'R1'), CAMP, CAT_LA, 'R1')
    const r = filterExcludedFindings(fs, facts, s, CAMP)
    expect(r.excluded).toBe(2)
    expect(r.kept.some((f) => f.ruleId === 'R2')).toBe(true)
  })
  it('ignores exclusions of other camps', () => {
    const r = filterExcludedFindings(fs, facts, excludeCategory(EMPTY_RULE_STATE, '/api/camps/x', CAT_LS, null), CAMP)
    expect(r.excluded).toBe(0)
  })
})
