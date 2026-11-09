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
 *
 * Red sources for redKeys (see redSources): an evidence label «Quelle: MiData/NDS» decides; without it the
 * rule's static tag ('midata' / 'nds') decides; without either, whichever aggregate is present in the context.
 */
import type {
  ExplainFact,
  ExplainInput,
  FindingExplanation,
  IsoDate,
  IsoDateTime,
  ModuleState,
  RuleContext,
  RuleHit,
  RuleMeta,
  RulePack,
  Severity,
} from '../types'

const SEVERITY_RANK: Record<Severity, number> = { must: 0, should: 1, hint: 2 }

function formatDate(iso: IsoDateTime | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** Which red sources contribute to this hit (rule tags, hit.redKeys, evidence labels, context). */
export function redSources(meta: RuleMeta, hit: RuleHit, ctx: RuleContext): { midata: boolean; nds: boolean } {
  const tags = meta.tags ?? []
  let midata = tags.includes('midata') || (meta.inputs ?? []).includes('midata')
  let nds = tags.includes('nds') || (meta.inputs ?? []).includes('nds')
  if (hit.redKeys && hit.redKeys.length > 0) {
    const labels = (hit.evidence ?? []).map((e) => e.label)
    const evMidata = labels.some((l) => /Quelle:\s*MiData/.test(l))
    const evNds = labels.some((l) => /Quelle:\s*NDS/.test(l))
    if (evMidata || evNds) {
      midata = midata || evMidata
      nds = nds || evNds
    } else if (!midata && !nds) {
      midata = !!ctx.midata
      nds = !!ctx.nds
      if (!midata && !nds) midata = true
    }
  }
  return { midata, nds }
}

export function buildExplanation(
  meta: RuleMeta,
  pack: RulePack | null,
  hit: RuleHit,
  ctx: RuleContext,
  evaluatedFor: IsoDate,
  finalSeverity: Severity,
  extra: { moduleState?: ModuleState; reason?: FindingExplanation['severityReason'] } = {},
): FindingExplanation {
  const inputs: ExplainInput[] = []
  for (const key of meta.inputs ?? []) {
    if (key === 'mapping') {
      inputs.push(ctx.mapping ? { key, state: 'used', detail: 'bestätigt' } : { key, state: 'missing' })
    } else if (key === 'coachInputs') {
      inputs.push({ key, state: ctx.coachInputs ? 'used' : 'missing' })
    } else if (key === 'documents') {
      const n = ctx.documents.length
      inputs.push(n > 0 ? { key, state: 'used', detail: `${n} ${n === 1 ? 'Dokument' : 'Dokumente'}` } : { key, state: 'missing' })
    } else if (key === 'midata' || key === 'nds') {
      // Reported below from redSources (with «Stand»).
    } else if (key === 'activityTags') {
      const n = Object.values(ctx.campConfig?.activityTags ?? {}).filter((t) => t.length > 0).length
      inputs.push(n > 0 ? { key, state: 'used', detail: `${n} ${n === 1 ? 'Aktivität' : 'Aktivitäten'}` } : { key, state: 'missing' })
    } else if (key === 'campConfig') {
      inputs.push({ key, state: ctx.campConfig && !ctx.campConfig.isDefault ? 'used' : 'missing' })
    } else {
      inputs.push({ key, state: 'used' })
    }
  }
  const src = redSources(meta, hit, ctx)
  if (src.midata) {
    const stand = formatDate(ctx.midata?.fetchedAt)
    inputs.push(ctx.midata ? { key: 'midata', state: 'used', ...(stand ? { detail: `Stand MiData ${stand}` } : {}) } : { key: 'midata', state: 'missing' })
  }
  if (src.nds) {
    const stand = formatDate(ctx.nds?.fetchedAt)
    inputs.push(ctx.nds ? { key: 'nds', state: 'used', ...(stand ? { detail: `Stand NDS ${stand}` } : {}) } : { key: 'nds', state: 'missing' })
  }

  const red = new Set(hit.redKeys ?? [])
  const facts: ExplainFact[] = []
  const seen = new Set<string>()
  const push = (key: string, value: string | number | boolean | null) => {
    if (seen.has(key)) return
    seen.add(key)
    facts.push(red.has(key) ? { key, value, red: true } : { key, value })
  }
  for (const [k, v] of Object.entries(hit.inputs ?? {})) push(k, v)
  for (const [k, v] of Object.entries(hit.params ?? {})) if (!k.startsWith('_')) push(k, v)

  let severityReason: FindingExplanation['severityReason'] = 'rule'
  if (extra.reason) {
    severityReason = extra.reason
  } else if (meta.severity === 'must' && (meta.confidence === 'unverified' || meta.confidence === 'conflict')) {
    severityReason = 'confidence-clamp'
  } else if (hit.severity && SEVERITY_RANK[hit.severity] > SEVERITY_RANK[meta.severity] && finalSeverity === hit.severity) {
    severityReason = 'hit-downgrade'
  }

  return {
    packId: pack?.id ?? null,
    packName: pack?.name ?? null,
    packVersion: pack?.version ?? null,
    ruleVersion: meta.version,
    validFrom: meta.validFrom ?? null,
    validTo: meta.validTo ?? null,
    evaluatedFor,
    evaluatedAt: ctx.now.toISOString(),
    baseSeverity: meta.severity,
    severityReason,
    module: meta.module,
    ...(extra.moduleState ? { moduleState: extra.moduleState } : {}),
    ...(meta.formerIds?.length ? { formerIds: meta.formerIds } : {}),
    inputs,
    facts,
  }
}
