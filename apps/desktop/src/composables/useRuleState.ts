/** Live view on the persisted disabled-rule state (settings key 'ruleState'). */
import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import { liveQuery } from 'dexie'
import { getRuleState } from '@/domain/rules/ruleStateStore'
import { EMPTY_RULE_STATE, type RuleState } from '@/domain/rules/ruleState'

export function useRuleState(): { state: ShallowRef<RuleState> } {
  const state = shallowRef<RuleState>(EMPTY_RULE_STATE)
  try {
    const sub = liveQuery(() => getRuleState()).subscribe({ next: (v) => (state.value = v), error: () => {} })
    onScopeDispose(() => sub.unsubscribe())
  } catch {
    /* no IndexedDB (tests) */
  }
  return { state }
}
