import { describe, expect, it } from 'vitest'
import {
  EMPTY_RULE_STATE,
  campsWithDisabled,
  disablePromptCount,
  disableRule,
  disabledRuleIds,
  enableRule,
  isGloballyDisabled,
  muteRule,
  normalizeRuleState,
} from '../ruleState'
import { evaluate } from '../engine'
import type { Override, Rule, RulePack } from '@/domain/types'
import { FactsBuilder, makeCtx } from './factory'

const ov = (campIri: string, ruleId: string, n: number): Override => ({
  id: `${campIri}-${ruleId}-${n}`,
  campIri,
  findingId: `${ruleId}:${n}`,
  ruleId,
  reason: '',
  createdAt: '',
})
const many = (campIri: string, ruleId: string, count: number) => Array.from({ length: count }, (_, i) => ov(campIri, ruleId, i))

describe('ignore threshold', () => {
  it('no prompt below 3 ignored findings in one camp', () => {
    expect(disablePromptCount(many('c1', 'R', 2), EMPTY_RULE_STATE, 'R', 'c1')).toBeNull()
  })
  it('prompts at 3 in the same camp with that count', () => {
    expect(disablePromptCount(many('c1', 'R', 3), EMPTY_RULE_STATE, 'R', 'c1')).toBe(3)
  })
  it('prompts when ignored in 2 different camps', () => {
    expect(disablePromptCount([...many('c1', 'R', 1), ...many('c2', 'R', 1)], EMPTY_RULE_STATE, 'R', 'c2')).toBe(2)
  })
  it('does not mix up rules', () => {
    expect(disablePromptCount([...many('c1', 'R', 2), ...many('c1', 'S', 2)], EMPTY_RULE_STATE, 'R', 'c1')).toBeNull()
  })
  it('no prompt when already disabled (camp or global) or muted for the camp', () => {
    const all = many('c1', 'R', 4)
    expect(disablePromptCount(all, disableRule(EMPTY_RULE_STATE, 'R', 'c1'), 'R', 'c1')).toBeNull()
    expect(disablePromptCount(all, disableRule(EMPTY_RULE_STATE, 'R', null), 'R', 'c1')).toBeNull()
    expect(disablePromptCount(all, muteRule(EMPTY_RULE_STATE, 'R', 'c1'), 'R', 'c1')).toBeNull()
    // muted only for that camp: another camp with enough ignores of its own still prompts
    const two = [...all, ...many('c2', 'R', 3)]
    expect(disablePromptCount(two, muteRule(EMPTY_RULE_STATE, 'R', 'c1'), 'R', 'c2')).toBe(3)
  })
})

describe('rule state', () => {
  it('disable / enable per camp and global', () => {
    let s = disableRule(EMPTY_RULE_STATE, 'R', 'c1')
    s = disableRule(s, 'R', 'c2')
    s = disableRule(s, 'R', 'c2') // idempotent
    expect(campsWithDisabled(s, 'R')).toBe(2)
    expect(disabledRuleIds(s, 'c1').has('R')).toBe(true)
    expect(disabledRuleIds(s, 'c3').has('R')).toBe(false)
    s = disableRule(s, 'R', null)
    expect(isGloballyDisabled(s, 'R')).toBe(true)
    expect(disabledRuleIds(s, 'c3').has('R')).toBe(true)
    expect(isGloballyDisabled(enableRule(s, 'R', null), 'R')).toBe(false)
    expect(enableRule(s, 'R').disabled).toEqual([])
  })
  it('normalizes garbage', () => {
    expect(normalizeRuleState(undefined)).toEqual(EMPTY_RULE_STATE)
    expect(normalizeRuleState({ disabled: [{ ruleId: 'R', campIri: null }, 5], muted: 'x' })).toEqual({
      disabled: [{ ruleId: 'R', campIri: null }],
      muted: [],
    })
  })
})

describe('evaluate skips disabled rules', () => {
  const rule = (id: string): Rule => ({
    meta: {
      id,
      version: '1',
      group: 'js',
      title: id,
      description: 'd',
      message: 'm',
      severity: 'should',
      confidence: 'verified',
      scope: 'camp',
      source: { title: 's', url: 'https://example.org' },
    },
    check: () => [{ targets: [] }],
  })
  const pack: RulePack = { id: 'p', name: 'P', version: '1', description: '', rules: [rule('T-A-01'), rule('T-B-01')] }
  const ctx = () => makeCtx(new FactsBuilder({ start: '2031-07-12' }).facts)

  it('returns all rules by default', () => {
    expect(evaluate([pack], ctx()).map((f) => f.ruleId).sort()).toEqual(['T-A-01', 'T-B-01'])
  })
  it('omits disabled rules for the camp', () => {
    const state = disableRule(EMPTY_RULE_STATE, 'T-A-01', 'c1')
    const out = evaluate([pack], ctx(), { disabledRuleIds: disabledRuleIds(state, 'c1') })
    expect(out.map((f) => f.ruleId)).toEqual(['T-B-01'])
  })
  it('a rule disabled for another camp still runs here', () => {
    const state = disableRule(EMPTY_RULE_STATE, 'T-A-01', 'c2')
    expect(evaluate([pack], ctx(), { disabledRuleIds: disabledRuleIds(state, 'c1') })).toHaveLength(2)
  })
  it('a globally disabled rule is skipped everywhere', () => {
    const state = disableRule(EMPTY_RULE_STATE, 'T-B-01', null)
    expect(evaluate([pack], ctx(), { disabledRuleIds: disabledRuleIds(state, 'cX') }).map((f) => f.ruleId)).toEqual(['T-A-01'])
  })
})
