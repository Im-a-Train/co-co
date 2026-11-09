/**
 * Rule edits store (Dexie table `ruleEdits`, ADR 0013) + the process-wide effective packs.
 * CONTRACT (main session): keep the exported signatures; implementation by the rule-edits agent.
 */
import type { EditOrigin, RuleEditPatch, RuleEditRecord, RulePack } from '../types'

export async function listRuleEdits(): Promise<RuleEditRecord[]> {
  throw new Error('not implemented')
}

/**
 * Validates (edits.ts policy, against the effective source registry), stores the minimal patch and
 * pushes the previous one to history. An empty minimal patch deletes the edit. Throws Error(German).
 */
export async function saveRuleEdit(
  _ruleId: string,
  _patch: RuleEditPatch,
  _opts: { origin: EditOrigin; reason?: string; resourceKeys?: string[] },
): Promise<RuleEditRecord | null> {
  throw new Error('not implemented')
}

/** Drops the edit of one rule (back to bundled). */
export async function resetRuleEdit(_ruleId: string): Promise<void> {
  throw new Error('not implemented')
}

/**
 * Synchronous effective packs: bundled packs with the last loaded edits applied. Before
 * `reloadRuleEdits()` ran (or while the store is locked) this equals loadBundledPacks().
 */
export function loadEffectivePacks(): RulePack[] {
  throw new Error('not implemented')
}

/** Reads the table and refreshes the cache behind loadEffectivePacks(); bumps the reactive version. */
export async function reloadRuleEdits(): Promise<void> {
  throw new Error('not implemented')
}
