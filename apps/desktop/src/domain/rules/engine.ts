/**
 * Rule engine. Pure (no Vue/Tauri/Dexie).
 *
 * - evaluate() completes the context (params, keywords, campConfig with module states, lazy ctx.js; see
 *   lib/context.ts) and runs every rule whose pack AND rule validity contain the camp start date (fallback:
 *   ctx.now), whose status is 'active', whose module is not 'off' for this camp and which is not disabled
 *   (by id or by one of its formerIds).
 * - Hits may only lower severity and confidence (confidence order verified > best-practice > heuristic >
 *   unverified > conflict). A 'suggested' module caps severity at hint (+ moduleNote); confidence
 *   'unverified' / 'conflict' caps severity at should.
 * - Message: `hit.variant` selects `messageVariants[variant]`; `hit.fragments` fill composite placeholders;
 *   legacy `params._message` still replaces the template.
 * - One RuleHit -> one Finding (id = `${ruleId}:${targets.join('|')}`; duplicates of the same id are dropped).
 * - Overrides match the finding id or the same targets under one of the rule's formerIds.
 * - A throwing predicate is logged and skipped. Output sorted by severity, then ruleId, then id.
 */
import type {
  Confidence,
  Evidence,
  Finding,
  FindingCounts,
  IsoDate,
  ModuleReason,
  ModuleState,
  ParamNote,
  ResolvedSource,
  Rule,
  RuleContext,
  RuleContextInput,
  RuleHit,
  RuleMeta,
  RulePack,
  Severity,
} from '../types'
import { MODULE_IDS } from '../types'
import { buildExplanation, redSources } from './explain'
import { completeContext, contextDate } from './lib/context'
import { primarySource } from './lib/sources'
import { getSourceRegistry } from './packs/registry'

const SEVERITY_RANK: Record<Severity, number> = { must: 0, should: 1, hint: 2 }
const SEVERITIES = Object.keys(SEVERITY_RANK)
/** Higher rank = weaker confidence. */
export const CONFIDENCE_RANK: Record<Confidence, number> = { verified: 0, 'best-practice': 1, heuristic: 2, unverified: 3, conflict: 4 }
const CONFIDENCES = Object.keys(CONFIDENCE_RANK)
const SCOPES = ['camp', 'day', 'activity', 'scheduleEntry', 'document']
const STATUSES = ['active', 'retired']
const INPUTS = ['mapping', 'coachInputs', 'documents', 'settings', 'midata', 'nds', 'campConfig', 'activityTags', 'params', 'keywords']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const RULE_ID_RE = /^[A-Z]+(-[A-Z0-9]+)+$/

export function findingId(ruleId: string, targets: string[]): string {
  return `${ruleId}:${targets.join('|')}`
}

/** True if `date` lies within [validFrom, validTo] (open ends allowed). ISO dates compare lexically. */
export function isValidOn(validity: { validFrom?: IsoDate; validTo?: IsoDate }, date: IsoDate): boolean {
  const d = date.slice(0, 10)
  if (validity.validFrom && d < validity.validFrom.slice(0, 10)) return false
  if (validity.validTo && d > validity.validTo.slice(0, 10)) return false
  return true
}

/** Human-readable validation errors of one rule (empty = valid), incl. the must-guards. Cross-file checks: packs/index.ts. */
export function validateRuleMeta(meta: RuleMeta): string[] {
  const errors: string[] = []
  const id = meta?.id || '?'
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(`${id}: ${msg}`)
  }
  need(typeof meta?.id === 'string' && RULE_ID_RE.test(meta.id), 'id fehlt oder ungültig')
  need(!!meta?.version, 'version fehlt')
  need((MODULE_IDS as readonly string[]).includes(meta?.module), `module ungültig (${String(meta?.module)})`)
  need(STATUSES.includes(meta?.status), 'status ungültig (active | retired)')
  need(!!meta?.title?.trim(), 'title fehlt')
  need(!!meta?.description?.trim(), 'description fehlt')
  need(!!meta?.message?.trim(), 'message fehlt')
  need(SEVERITIES.includes(meta?.severity), 'severity ungültig')
  need(CONFIDENCES.includes(meta?.confidence), 'confidence ungültig')
  need(SCOPES.includes(meta?.scope), 'scope ungültig')
  need(Array.isArray(meta?.sources) && meta.sources.length > 0 && meta.sources.every((s) => !!s?.key), 'sources fehlt (mindestens eine Quelle mit key)')
  need(!meta?.validFrom || DATE_RE.test(meta.validFrom), 'validFrom ist kein Datum (YYYY-MM-DD)')
  need(!meta?.validTo || DATE_RE.test(meta.validTo), 'validTo ist kein Datum (YYYY-MM-DD)')
  need(!meta?.inputs || meta.inputs.every((i) => INPUTS.includes(i)), 'inputs enthält einen unbekannten Wert')
  need(!meta?.formerIds || meta.formerIds.every((f) => RULE_ID_RE.test(f) && f !== meta.id), 'formerIds ungültig')
  need(
    !meta?.messageVariants || Object.values(meta.messageVariants).every((v) => typeof v === 'string'),
    'messageVariants müssen Texte sein',
  )
  if (meta?.severity === 'must' && meta.confidence !== 'verified') {
    errors.push(`${id}: severity 'must' verlangt confidence 'verified' (ist '${meta.confidence}')`)
  }
  return errors
}

export function fillTemplate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in params ? String(params[key]) : m))
}

/** Template of a hit: variant (falls back to the main message), else legacy `_message`, else meta.message. */
export function hitTemplate(meta: RuleMeta, hit: RuleHit): string {
  if (hit.variant) {
    const v = meta.messageVariants?.[hit.variant]
    if (v !== undefined) return v
    console.warn(`[rules] ${meta.id}: messageVariant «${hit.variant}» fehlt`)
  }
  return typeof hit.params?._message === 'string' ? hit.params._message : meta.message
}

/** Final message of a hit (variants, fragments, placeholders). Exported for predicate tests. */
export function renderMessage(meta: RuleMeta, hit: RuleHit): string {
  const params: Record<string, string | number> = { ...(hit.params ?? {}) }
  for (const [name, parts] of Object.entries(hit.fragments ?? {})) {
    const join = meta.messageVariants?.[`${name}Join`] ?? '; '
    params[name] = parts
      .map((f) => {
        const t = meta.messageVariants?.[f.variant]
        if (t === undefined) console.warn(`[rules] ${meta.id}: messageVariant «${f.variant}» fehlt`)
        return fillTemplate(t ?? f.variant, { ...params, ...(f.params ?? {}) })
      })
      .join(join)
  }
  return fillTemplate(hitTemplate(meta, hit), params)
}

export interface HitOutcome {
  severity: Severity
  confidence: Confidence
  reason: 'rule' | 'hit-downgrade' | 'confidence-clamp' | 'module-suggested'
}

/** Severity/confidence of a hit after downgrades and caps (§3.6 step 4). */
export function hitOutcome(meta: RuleMeta, hit: Pick<RuleHit, 'severity' | 'confidence'>, moduleState: ModuleState = 'on'): HitOutcome {
  let reason: HitOutcome['reason'] = 'rule'
  let severity = meta.severity
  if (hit.severity && SEVERITY_RANK[hit.severity] > SEVERITY_RANK[severity]) {
    severity = hit.severity
    reason = 'hit-downgrade'
  }
  let confidence = meta.confidence
  if (hit.confidence && CONFIDENCE_RANK[hit.confidence] > CONFIDENCE_RANK[confidence]) confidence = hit.confidence
  if (severity === 'must' && (confidence === 'unverified' || confidence === 'conflict')) {
    severity = 'should'
    reason = 'confidence-clamp'
  }
  if (moduleState === 'suggested' && severity !== 'hint') {
    severity = 'hint'
    reason = 'module-suggested'
  }
  return { severity, confidence, reason }
}

/** Findings quoting MiData (red-derived) carry the tag 'midata'; they must never reach the AI. */
const MIDATA_SOURCE_RE = /Quelle:\s*MiData/
/** Same for NDS: tag 'nds-quelle' (the static rule tag 'nds' only names the topic). */
const NDS_SOURCE_RE = /Quelle:\s*NDS/

function resolveSources(meta: RuleMeta): ResolvedSource[] {
  const reg = getSourceRegistry()
  return meta.sources.map((s) => reg.resolve(s)).filter((s): s is ResolvedSource => s !== null)
}

function paramNotesOf(meta: RuleMeta, ctx: RuleContext): ParamNote[] {
  const notes: ParamNote[] = []
  for (const key of meta.params ?? []) {
    try {
      const o = ctx.params.isOverridden(key)
      if (o) notes.push({ key, label: ctx.params.def(key)?.label ?? key, value: o.value, default: o.default })
    } catch {
      // Unknown param for this camp date: nothing to note.
    }
  }
  return notes
}

function evaluateRule(rule: Rule, pack: RulePack | null, ctx: RuleContext, campDate: IsoDate, moduleState: ModuleState): Finding[] {
  const hits = rule.check(ctx)
  const out: Finding[] = []
  const meta = rule.meta
  const sources = resolveSources(meta)
  const source = sources.length ? primarySource(sources) : meta.source
  const paramNotes = hits.length ? paramNotesOf(meta, ctx) : []
  const reasons = ctx.campConfig.moduleStates[meta.module]?.reasons ?? []
  const moduleNote: ModuleReason | null =
    moduleState === 'suggested'
      ? {
          key: 'rules.module.suggestedNote',
          params: { module: meta.module, reasonKey: reasons[0]?.key ?? '', ...(reasons[0]?.params ?? {}) },
        }
      : null
  for (const hit of hits) {
    const targets = hit.targets.length ? hit.targets : [ctx.facts.camp.iri]
    const id = findingId(meta.id, targets)
    const evidence: Evidence[] = hit.evidence ?? []
    const message = renderMessage(meta, hit)
    const outcome = hitOutcome(meta, hit, moduleState)
    // Red-derived facts (hit.redKeys) also count as red where tags are used: add the source tag unless present.
    const tags = [
      ...(meta.tags ?? []),
      ...(evidence.some((e) => MIDATA_SOURCE_RE.test(e.label)) || MIDATA_SOURCE_RE.test(message) ? ['midata'] : []),
      ...(evidence.some((e) => NDS_SOURCE_RE.test(e.label)) || NDS_SOURCE_RE.test(message) ? ['nds-quelle'] : []),
    ]
    if (hit.redKeys && hit.redKeys.length > 0) {
      const src = redSources(meta, hit, ctx)
      if (src.midata && !tags.includes('midata')) tags.push('midata')
      if (src.nds && !tags.includes('nds-quelle')) tags.push('nds-quelle')
    }
    const formerFindingIds = (meta.formerIds ?? []).map((f) => findingId(f, targets))
    out.push({
      id,
      ruleId: meta.id,
      ruleVersion: meta.version,
      packId: pack?.id ?? null,
      module: meta.module,
      severity: outcome.severity,
      confidence: outcome.confidence,
      title: meta.title,
      message,
      scope: meta.scope,
      targets,
      evidence,
      source,
      sources,
      paramNotes,
      moduleNote,
      origin: 'rule',
      tags,
      override: ctx.overrides.find((o) => o.findingId === id) ?? ctx.overrides.find((o) => formerFindingIds.includes(o.findingId)) ?? null,
      explain: buildExplanation(meta, pack, hit, ctx, campDate, outcome.severity, { moduleState, reason: outcome.reason }),
    })
  }
  return out
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export interface EvaluateOptions {
  /** Rule ids that are switched off (by the coach, per camp or globally): skipped entirely (formerIds count too). */
  disabledRuleIds?: ReadonlySet<string>
}

/** True when the rule is disabled under its id or one of its formerIds. */
export function isDisabled(meta: RuleMeta, disabled: ReadonlySet<string> | undefined): boolean {
  if (!disabled || disabled.size === 0) return false
  return disabled.has(meta.id) || (meta.formerIds ?? []).some((f) => disabled.has(f))
}

/** Effective module state of a rule for this camp ('on' when no loaded pack defines the module). */
export function ruleModuleState(meta: RuleMeta, ctx: RuleContext): ModuleState {
  return ctx.campConfig.moduleStates[meta.module]?.state ?? 'on'
}

export function evaluate(packs: RulePack[], input: RuleContextInput, opts: EvaluateOptions = {}): Finding[] {
  const ctx = completeContext(packs, input)
  const campDate: IsoDate = contextDate(input)
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (const pack of packs) {
    if (!isValidOn(pack, campDate)) continue
    for (const rule of pack.rules) {
      if (rule.meta.status === 'retired') continue
      if (!isValidOn(rule.meta, campDate)) continue
      if (isDisabled(rule.meta, opts.disabledRuleIds)) continue
      const moduleState = ruleModuleState(rule.meta, ctx)
      if (moduleState === 'off') continue
      let produced: Finding[]
      try {
        produced = evaluateRule(rule, pack, ctx, campDate, moduleState)
      } catch (e) {
        console.error(`[rules] ${rule.meta.id} failed`, e)
        continue
      }
      for (const f of produced) {
        if (seen.has(f.id)) continue
        seen.add(f.id)
        findings.push(f)
      }
    }
  }
  return findings.sort(compareFindings)
}

/** Counts by severity; overridden findings only count towards `overridden`. */
export function countFindings(findings: Finding[]): FindingCounts {
  const counts: FindingCounts = { must: 0, should: 0, hint: 0, overridden: 0 }
  for (const f of findings) {
    if (f.override) counts.overridden++
    else counts[f.severity]++
  }
  return counts
}
