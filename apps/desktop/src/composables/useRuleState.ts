/** Live view on the persisted disabled-rule state (settings key 'ruleState'). */
import { onScopeDispose, shallowRef, watch, type ShallowRef } from 'vue'
import { useDataStore } from '@/composables/useDataStore'
import { liveQuery } from 'dexie'
import { getRuleState } from '@/domain/rules/ruleStateStore'
import { EMPTY_RULE_STATE, type RuleState } from '@/domain/rules/ruleState'

export function useRuleState(): { state: ShallowRef<RuleState> } {
  const state = shallowRef<RuleState>(EMPTY_RULE_STATE)
  const { ready } = useDataStore()
  let unsub: (() => void) | null = null
  const stop = () => {
    unsub?.()
    unsub = null
  }
  // Only subscribe while the encrypted store is unlocked (a locked store throws LockedError).
  watch(
    ready,
    (isReady) => {
      stop()
      if (!isReady) {
        state.value = EMPTY_RULE_STATE
        return
      }
      try {
        const sub = liveQuery(() => getRuleState()).subscribe({ next: (v) => (state.value = v), error: () => {} })
        unsub = () => sub.unsubscribe()
      } catch {
        /* no IndexedDB (tests) */
      }
    },
    { immediate: true },
  )
  onScopeDispose(stop)
  return { state }
}
