/**
 * Leader self-check («Entwurfsrunde»). Pure.
 *
 * The same rules run for the Lagerleitung before they submit to the coach. A run stores the open
 * findings; the next run (or the coach's review) shows what was fixed since.
 */
import { messages, type MessageTree } from '../../locales/messages'
import { activityLabel } from '../cockpit'
import { ecampActivityUrl } from '../ecampLinks'
import { activityIriOfFinding } from '../triage'
import type {
  CampFacts,
  CollaboratorRole,
  Finding,
  FindingCounts,
  Iri,
  IsoDateTime,
  SelfCheckFinding,
  SelfCheckRun,
  Severity,
} from '../types'

function tr(key: string, params: Record<string, string | number> = {}): string {
  let node: string | MessageTree | undefined = messages.de as MessageTree
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return key
    node = node[part]
  }
  if (typeof node !== 'string') return key
  return node.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

const SEVERITY_ORDER: readonly Severity[] = ['must', 'should', 'hint']

/** Leaders (role member / manager) see the self-check as their main view; guests are coaches. */
export function isLeaderRole(role: CollaboratorRole | null | undefined): boolean {
  return role === 'member' || role === 'manager'
}

/** True when the finding quotes MiData/NDS (never leaves the machine by default). */
function isRedDerived(f: Pick<Finding, 'tags'>): boolean {
  const tags = f.tags ?? []
  return tags.includes('midata') || tags.includes('nds-quelle')
}

/** Rule findings that are neither ignored nor AI-made. */
function openRuleFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.override && f.origin === 'rule')
}

/** Open findings (no override, origin 'rule') as SelfCheckFinding; redDerived from tags midata / nds-quelle. */
export function toSelfCheckFindings(findings: Finding[]): SelfCheckFinding[] {
  return openRuleFindings(findings).map((f) => ({
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    title: f.title,
    message: f.message,
    targets: [...f.targets],
    redDerived: isRedDerived(f),
  }))
}

export function planSelfCheckRun(input: {
  id: string
  campIri: Iri
  by: SelfCheckRun['by']
  snapshotId: string | null
  note: string
  counts: FindingCounts
  validJsDays: number | null
  totalDays: number | null
  findings: Finding[]
  now: IsoDateTime
}): SelfCheckRun {
  return {
    id: input.id,
    campIri: input.campIri,
    createdAt: input.now,
    by: input.by,
    snapshotId: input.snapshotId,
    note: input.note.trim(),
    counts: { ...input.counts },
    validJsDays: input.validJsDays,
    totalDays: input.totalDays,
    findings: toSelfCheckFindings(input.findings),
  }
}

export interface SelfCheckProgress {
  /** In the previous run, no longer present now. */
  fixed: SelfCheckFinding[]
  /** In both. */
  remaining: SelfCheckFinding[]
  /** New since the previous run. */
  added: SelfCheckFinding[]
}

/** Compares a previous run with the current open findings (by finding id). */
export function compareWithRun(previous: SelfCheckRun | null, current: Finding[]): SelfCheckProgress {
  const now = toSelfCheckFindings(current)
  if (!previous) return { fixed: [], remaining: [], added: now }
  const nowIds = new Set(now.map((f) => f.id))
  const prevIds = new Set(previous.findings.map((f) => f.id))
  return {
    fixed: previous.findings.filter((f) => !nowIds.has(f.id)),
    remaining: now.filter((f) => prevIds.has(f.id)),
    added: now.filter((f) => !prevIds.has(f.id)),
  }
}

export interface SelfCheckReportOptions {
  /** Include findings that quote MiData/NDS (default false: the report may leave the coach's machine). */
  includeRedDerived?: boolean
  /** eCamp base URL for activity links (null = no links). */
  instanceBaseUrl: string | null
  now: Date
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Plain-text report (German) for the Lagerleitung: header with camp + date + counts + J+S days,
 * then findings grouped Muss / Soll / Hinweis, each with activity label («Nr. Titel») and eCamp link,
 * then «Behoben seit letztem Selbstcheck» when `progress` is given. Ready for the clipboard.
 */
export function renderSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: { valid: number; total: number } | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
): string {
  const include = opts.includeRedDerived === true
  const visible = openRuleFindings(findings).filter((f) => include || !isRedDerived(f))
  const linkFacts = { ...facts, instanceBaseUrl: opts.instanceBaseUrl }
  const count = (sev: Severity) => visible.filter((f) => f.severity === sev).length
  const lines: string[] = []
  lines.push(tr('selfCheck.report.heading', { camp: facts.camp.title, date: formatDate(opts.now) }))
  lines.push(tr('selfCheck.report.counts', { must: count('must'), should: count('should'), hint: count('hint') }))
  if (jsDays) lines.push(tr('selfCheck.report.jsDays', { valid: jsDays.valid, total: jsDays.total }))
  for (const sev of SEVERITY_ORDER) {
    const group = visible.filter((f) => f.severity === sev).sort((a, b) => a.ruleId.localeCompare(b.ruleId))
    if (group.length === 0) continue
    lines.push('', tr(`selfCheck.report.group.${sev}`, { n: group.length }))
    for (const f of group) {
      const actIri = activityIriOfFinding(f, facts)
      const label = actIri ? activityLabel(facts, actIri) : null
      lines.push(`- ${label ? `${label}: ` : ''}${f.title}: ${f.message}`)
      const url = actIri && opts.instanceBaseUrl ? ecampActivityUrl(linkFacts, actIri) : null
      if (url) lines.push(`  ${tr('selfCheck.report.link')}: ${url}`)
    }
  }
  if (visible.length === 0) lines.push('', tr('selfCheck.report.none'))
  if (progress) {
    const fixed = progress.fixed.filter((f) => include || !f.redDerived)
    if (fixed.length > 0) {
      lines.push('', tr('selfCheck.report.fixedHeading', { n: fixed.length }))
      for (const f of fixed) lines.push(`- ${f.title}`)
    }
  }
  return lines.join('\n') + '\n'
}
