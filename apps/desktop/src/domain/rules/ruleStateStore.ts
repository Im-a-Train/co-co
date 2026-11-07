/** Persistence of RuleState in the settings table (key 'ruleState', no schema change; included in backups). */
import { getDb } from '../storage/db'
import type { Iri } from '../types'
import { disableRule, enableRule, muteRule, normalizeRuleState, type RuleState } from './ruleState'

const KEY = 'ruleState'

export async function getRuleState(): Promise<RuleState> {
  const rec = await getDb().settings.get(KEY)
  return normalizeRuleState(rec?.value)
}

async function mutate(fn: (s: RuleState) => RuleState): Promise<RuleState> {
  const db = getDb()
  return db.transaction('rw', db.settings, async () => {
    const next = fn(await getRuleState())
    await db.settings.put({ key: KEY, value: next })
    return next
  })
}

export const disableRuleStored = (ruleId: string, campIri: Iri | null) => mutate((s) => disableRule(s, ruleId, campIri))
export const enableRuleStored = (ruleId: string, campIri?: Iri | null) => mutate((s) => enableRule(s, ruleId, campIri))
export const muteRuleStored = (ruleId: string, campIri: Iri) => mutate((s) => muteRule(s, ruleId, campIri))

export function listAllOverrides() {
  return getDb().overrides.toArray()
}
