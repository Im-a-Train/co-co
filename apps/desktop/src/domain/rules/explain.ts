/**
 * Explainability panel: builds `Finding.explain` (pure). Called by engine.evaluateRule for every hit.
 *
 * - inputs: one ExplainInput per entry of `meta.inputs` (mapping: used when ctx.mapping is set, detail
 *   «bestätigt»; coachInputs: used when ctx.coachInputs is set; documents: used when
 *   ctx.documents.length > 0, detail «N Dokumente»; settings: always used), plus 'midata' / 'nds' when the
 *   rule has tag 'midata' / 'nds' or the hit has redKeys (state used when ctx.midata / ctx.nds is set,
 *   detail «Stand MiData <dd.mm.yyyy>» from the aggregate's fetch time if available, else 'missing').
 * - facts: hit.inputs first, then hit.params without keys starting with '_', dedup by key;
 *   `red: true` for keys in hit.redKeys.
 * - severityReason: 'confidence-clamp' when meta.severity is must and confidence unverified/conflict;
 *   else 'hit-downgrade' when hit.severity lowered it; else 'rule'.
 */
import type { FindingExplanation, IsoDate, RuleContext, RuleHit, RuleMeta, RulePack, Severity } from '../types'

export function buildExplanation(
  meta: RuleMeta,
  pack: RulePack | null,
  hit: RuleHit,
  ctx: RuleContext,
  evaluatedFor: IsoDate,
  finalSeverity: Severity,
): FindingExplanation {
  void [meta, pack, hit, ctx, evaluatedFor, finalSeverity]
  throw new Error('not implemented')
}
