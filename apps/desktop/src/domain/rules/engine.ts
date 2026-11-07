/**
 * Rule engine. Pure (no Vue/Tauri/Dexie).
 *
 * - evaluate() runs every rule of every pack whose validity (pack AND rule validFrom/validTo) contains
 *   the camp start date (fallback: ctx.now when the camp has no dates).
 * - Guard: 'unverified' / 'conflict' rules can never produce severity 'must' (clamped to 'should').
 * - One RuleHit -> one Finding (id = `${ruleId}:${targets.join('|')}`; duplicates of the same id are dropped).
 * - A hit may replace the message template via `params._message` (for special cases such as missing inputs).
 * - A throwing predicate is logged and skipped.
 * - Output sorted by severity (must, should, hint), then ruleId, then id.
 */
import type {
  Evidence,
  Finding,
  FindingCounts,
  IsoDate,
  Rule,
  RuleContext,
  RuleMeta,
  RulePack,
  Severity,
} from '../types'

const SEVERITY_RANK: Record<Severity, number> = { must: 0, should: 1, hint: 2 }
const SEVERITIES = Object.keys(SEVERITY_RANK)
const CONFIDENCES = ['verified', 'conflict', 'unverified', 'best-practice', 'heuristic']
const GROUPS = ['js', 'completeness', 'safety', 'best-practice']
const SCOPES = ['camp', 'day', 'activity', 'scheduleEntry', 'document']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

/** Human-readable validation errors (empty = valid), incl. the must-guard. */
export function validateRuleMeta(meta: RuleMeta): string[] {
  const errors: string[] = []
  const id = meta?.id || '?'
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(`${id}: ${msg}`)
  }
  need(typeof meta?.id === 'string' && /^[A-Z]+(-[A-Z0-9]+)+$/.test(meta.id), 'id fehlt oder ungültig')
  need(!!meta?.version, 'version fehlt')
  need(GROUPS.includes(meta?.group), 'group ungültig')
  need(!!meta?.title?.trim(), 'title fehlt')
  need(!!meta?.description?.trim(), 'description fehlt')
  need(!!meta?.message?.trim(), 'message fehlt')
  need(SEVERITIES.includes(meta?.severity), 'severity ungültig')
  need(CONFIDENCES.includes(meta?.confidence), 'confidence ungültig')
  need(SCOPES.includes(meta?.scope), 'scope ungültig')
  need(!!meta?.source?.title && /^https?:\/\//.test(meta?.source?.url ?? ''), 'source (title + url) fehlt')
  need(!meta?.validFrom || DATE_RE.test(meta.validFrom), 'validFrom ist kein Datum (YYYY-MM-DD)')
  need(!meta?.validTo || DATE_RE.test(meta.validTo), 'validTo ist kein Datum (YYYY-MM-DD)')
  if ((meta?.confidence === 'unverified' || meta?.confidence === 'conflict') && meta.severity === 'must') {
    errors.push(`${id}: confidence '${meta.confidence}' darf nicht severity 'must' haben`)
  }
  return errors
}

export function fillTemplate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in params ? String(params[key]) : m))
}

function effectiveSeverity(meta: RuleMeta, hitSeverity: Severity | undefined): Severity {
  let sev = meta.severity
  // A hit may only downgrade.
  if (hitSeverity && SEVERITY_RANK[hitSeverity] > SEVERITY_RANK[sev]) sev = hitSeverity
  if (sev === 'must' && (meta.confidence === 'unverified' || meta.confidence === 'conflict')) sev = 'should'
  return sev
}

/** Findings quoting MiData (red-derived) carry the tag 'midata'; they must never reach the AI. */
const MIDATA_SOURCE_RE = /Quelle:\s*MiData/
/** Same for NDS: tag 'nds-quelle' (the static rule tag 'nds' only names the topic). */
const NDS_SOURCE_RE = /Quelle:\s*NDS/

function evaluateRule(rule: Rule, pack: RulePack | null, ctx: RuleContext): Finding[] {
  const hits = rule.check(ctx)
  const out: Finding[] = []
  for (const hit of hits) {
    const targets = hit.targets.length ? hit.targets : [ctx.facts.camp.iri]
    const id = findingId(rule.meta.id, targets)
    const evidence: Evidence[] = hit.evidence ?? []
    const message = fillTemplate(
      typeof hit.params?._message === 'string' ? hit.params._message : rule.meta.message,
      hit.params,
    )
    out.push({
      id,
      ruleId: rule.meta.id,
      ruleVersion: rule.meta.version,
      packId: pack?.id ?? null,
      severity: effectiveSeverity(rule.meta, hit.severity),
      confidence: rule.meta.confidence,
      title: rule.meta.title,
      message,
      scope: rule.meta.scope,
      targets,
      evidence,
      source: rule.meta.source,
      origin: 'rule',
      tags: [
        ...(rule.meta.tags ?? []),
        ...(evidence.some((e) => MIDATA_SOURCE_RE.test(e.label)) || MIDATA_SOURCE_RE.test(message) ? ['midata'] : []),
        ...(evidence.some((e) => NDS_SOURCE_RE.test(e.label)) || NDS_SOURCE_RE.test(message) ? ['nds-quelle'] : []),
      ],
      override: ctx.overrides.find((o) => o.findingId === id) ?? null,
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
  /** Rule ids that are switched off (by the coach, per camp or globally): skipped entirely. */
  disabledRuleIds?: ReadonlySet<string>
}

export function evaluate(packs: RulePack[], ctx: RuleContext, opts: EvaluateOptions = {}): Finding[] {
  const campDate: IsoDate = ctx.facts.camp.start ?? ctx.now.toISOString().slice(0, 10)
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (const pack of packs) {
    if (!isValidOn(pack, campDate)) continue
    for (const rule of pack.rules) {
      if (!isValidOn(rule.meta, campDate)) continue
      if (opts.disabledRuleIds?.has(rule.meta.id)) continue
      let produced: Finding[]
      try {
        produced = evaluateRule(rule, pack, ctx)
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
