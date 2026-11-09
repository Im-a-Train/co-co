/**
 * Rule edits (ADR 0013): coach overrides of bundled rule metadata. Pure, no Dexie.
 * CONTRACT (main session): keep the exported signatures; implementation by the rule-edits agent.
 *
 * Policy (on top of the engine's): `must` needs `confidence: verified`; edits with origin 'ai' or 'mcp'
 * may never set severity `must` nor confidence `verified` (only a manual edit can); predicates,
 * scope, inputs, params and keyword wiring are never editable.
 */
import type { EditOrigin, RuleEditPatch, RuleEditRecord, RuleMeta, RulePack, SourceRef } from '../types'

/** German validation errors; [] = ok. `knownSourceKeys` = effective registry keys. */
export function validateRuleEditPatch(
  _meta: RuleMeta,
  _patch: RuleEditPatch,
  _origin: EditOrigin,
  _knownSourceKeys: ReadonlySet<string>,
): string[] {
  throw new Error('not implemented')
}

/** Rule meta with the patch applied (re-derives `source`, `group`). Does not validate. */
export function applyRulePatch(_meta: RuleMeta, _patch: RuleEditPatch): RuleMeta {
  throw new Error('not implemented')
}

/** Packs with all valid edits applied; invalid edits are skipped and reported. Input packs untouched. */
export function applyRuleEdits(
  _packs: readonly RulePack[],
  _edits: readonly RuleEditRecord[],
  _knownSourceKeys: ReadonlySet<string>,
): { packs: RulePack[]; errors: Array<{ ruleId: string; errors: string[] }> } {
  throw new Error('not implemented')
}

/** Minimal patch: only fields that differ from the bundled meta (used before saving). */
export function diffPatch(_bundled: RuleMeta, _patch: RuleEditPatch): RuleEditPatch {
  throw new Error('not implemented')
}

export type { SourceRef }
