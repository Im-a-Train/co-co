/**
 * Leader self-check («Entwurfsrunde»). Pure.
 *
 * The same rules run for the Lagerleitung before they submit to the coach. A run stores the open
 * findings; the next run (or the coach's review) shows what was fixed since.
 */
import { messages, type MessageTree } from '../../locales/messages'
import { activityLabel } from '../cockpit'
import { escapeHtml } from '../feedback'
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

export interface SelfCheckReportItem {
  findingId: string
  title: string
  message: string
  /** «Nr. Titel» of the activity the finding points at. */
  activityLabel: string | null
  /** eCamp link of that activity (null without base URL). */
  url: string | null
}

export interface SelfCheckReportGroup {
  severity: Severity
  items: SelfCheckReportItem[]
}

export interface SelfCheckReportModel {
  heading: string
  counts: { must: number; should: number; hint: number }
  jsDays: { valid: number; total: number } | null
  groups: SelfCheckReportGroup[]
  /** «Behoben seit letztem Selbstcheck»: titles only. */
  fixed: { id: string; title: string }[]
}

/** Structured report (open findings grouped Muss / Soll / Hinweis, fixed list). Pure. */
export function buildSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: { valid: number; total: number } | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
): SelfCheckReportModel {
  const include = opts.includeRedDerived === true
  const visible = openRuleFindings(findings).filter((f) => include || !isRedDerived(f))
  const linkFacts = { ...facts, instanceBaseUrl: opts.instanceBaseUrl }
  const count = (sev: Severity) => visible.filter((f) => f.severity === sev).length
  const groups: SelfCheckReportGroup[] = []
  for (const severity of SEVERITY_ORDER) {
    const group = visible.filter((f) => f.severity === severity).sort((a, b) => a.ruleId.localeCompare(b.ruleId))
    if (group.length === 0) continue
    groups.push({
      severity,
      items: group.map((f) => {
        const actIri = activityIriOfFinding(f, facts)
        return {
          findingId: f.id,
          title: f.title,
          message: f.message,
          activityLabel: actIri ? activityLabel(facts, actIri) : null,
          url: actIri && opts.instanceBaseUrl ? ecampActivityUrl(linkFacts, actIri) : null,
        }
      }),
    })
  }
  const fixed = progress ? progress.fixed.filter((f) => include || !f.redDerived).map((f) => ({ id: f.id, title: f.title })) : []
  return {
    heading: tr('selfCheck.report.heading', { camp: facts.camp.title, date: formatDate(opts.now) }),
    counts: { must: count('must'), should: count('should'), hint: count('hint') },
    jsDays,
    groups,
    fixed,
  }
}

function countsLine(m: SelfCheckReportModel): string {
  return tr('selfCheck.report.counts', m.counts)
}
function jsDaysLine(m: SelfCheckReportModel): string | null {
  return m.jsDays ? tr('selfCheck.report.jsDays', m.jsDays) : null
}

/** Plain-text report (German) from the model; the eCamp URL follows the activity label in parentheses. */
export function renderSelfCheckReportText(m: SelfCheckReportModel): string {
  const lines: string[] = [m.heading, countsLine(m)]
  const js = jsDaysLine(m)
  if (js) lines.push(js)
  for (const g of m.groups) {
    lines.push('', tr(`selfCheck.report.group.${g.severity}`, { n: g.items.length }))
    for (const it of g.items) {
      const label = it.activityLabel ? `${it.activityLabel}${it.url ? ` (${it.url})` : ''}: ` : ''
      lines.push(`- ${label}${it.title}: ${it.message}`)
    }
  }
  if (m.groups.length === 0) lines.push('', tr('selfCheck.report.none'))
  if (m.fixed.length > 0) {
    lines.push('', tr('selfCheck.report.fixedHeading', { n: m.fixed.length }))
    for (const f of m.fixed) lines.push(`- ${f.title}`)
  }
  return lines.join('\n') + '\n'
}

/** Mail-friendly HTML: the activity label (or the title) is the link, no raw URL is visible. */
export function renderSelfCheckReportHtml(m: SelfCheckReportModel): string {
  const parts: string[] = [`<h3>${escapeHtml(m.heading)}</h3>`]
  const js = jsDaysLine(m)
  parts.push(`<p>${escapeHtml(countsLine(m))}${js ? `<br>${escapeHtml(js)}` : ''}</p>`)
  for (const g of m.groups) {
    parts.push(`<h4>${escapeHtml(tr(`selfCheck.report.group.${g.severity}`, { n: g.items.length }))}</h4>`, '<ul>')
    for (const it of g.items) {
      const link = (text: string) => (it.url ? `<a href="${escapeHtml(it.url)}">${escapeHtml(text)}</a>` : escapeHtml(text))
      const head = it.activityLabel ? `${link(it.activityLabel)}: ${escapeHtml(it.title)}` : link(it.title)
      parts.push(`<li>${head}: ${escapeHtml(it.message)}</li>`)
    }
    parts.push('</ul>')
  }
  if (m.groups.length === 0) parts.push(`<p>${escapeHtml(tr('selfCheck.report.none'))}</p>`)
  if (m.fixed.length > 0) {
    parts.push(`<h4>${escapeHtml(tr('selfCheck.report.fixedHeading', { n: m.fixed.length }))}</h4>`, '<ul>')
    for (const f of m.fixed) parts.push(`<li>${escapeHtml(f.title)}</li>`)
    parts.push('</ul>')
  }
  return parts.join('\n')
}

/** Plain-text report for the clipboard (built from the model). */
export function renderSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: { valid: number; total: number } | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
): string {
  return renderSelfCheckReportText(buildSelfCheckReport(facts, findings, jsDays, progress, opts))
}
