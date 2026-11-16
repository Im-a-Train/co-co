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
import { activityIriOfFinding, findingTarget } from '../triage'
import type {
  CampFacts,
  CollaboratorRole,
  Finding,
  FindingCounts,
  Iri,
  IsoDate,
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

/**
 * Open findings (no override, origin 'rule') as SelfCheckFinding; redDerived from tags midata / nds-quelle.
 * Coach homework (needsInput) is left out: the self-check is the leaders' view and they cannot act on it.
 */
export function toSelfCheckFindings(findings: Finding[]): SelfCheckFinding[] {
  return openRuleFindings(findings).filter((f) => !f.needsInput).map((f) => ({
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    title: f.title,
    message: f.message,
    targets: [...f.targets],
    redDerived: isRedDerived(f),
  }))
}

/**
 * Counts stored with a run (history line «0 Muss, 0 Soll, 12 Hinweis»): like countFindings, but without
 * coach homework (needsInput), so the history agrees with the progress columns and the report.
 */
export function selfCheckRunCounts(findings: readonly Finding[]): FindingCounts {
  const counts: FindingCounts = { must: 0, should: 0, hint: 0, overridden: 0 }
  for (const f of findings) {
    if (f.needsInput) continue
    if (f.override) counts.overridden++
    else counts[f.severity]++
  }
  return counts
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

/** A finding that left and re-entered under another id (same rule, same subject): variant or severity changed. */
export interface SelfCheckChange {
  before: SelfCheckFinding
  now: SelfCheckFinding
  /** True when the severity differs («jetzt Muss (vorher Hinweis)»), false for a plain «geändert». */
  severityChanged: boolean
}

export interface SelfCheckProgress {
  /** In the previous run, no longer present now (and not paired with a changed finding). */
  fixed: SelfCheckFinding[]
  /** In both, plus the «now» side of every pair in `changed`. */
  remaining: SelfCheckFinding[]
  /** New since the previous run (without the «now» side of a pair). */
  added: SelfCheckFinding[]
  /** Pairs fixed + added that share ruleId and first target, keyed by the id of the finding now. */
  changed: Record<string, SelfCheckChange>
}

/**
 * Compares a previous run with the current open findings (by finding id). Fixed and added entries
 * that share ruleId and first target (the subject IRI) are one finding whose id changed (e.g. the
 * «Zuordnung fehlt» hint [camp, 'noMapping'] became the real J+S-days finding [camp]): they move to
 * `remaining` as `changed`. Only one side may carry extra targets: two different extra targets on
 * the same subject name different things (JS-DL-03 'leihmaterial' vs 'landeskarten', two documents)
 * and stay fixed + added.
 */
export function compareWithRun(previous: SelfCheckRun | null, current: Finding[]): SelfCheckProgress {
  const now = toSelfCheckFindings(current)
  if (!previous) return { fixed: [], remaining: [], added: now, changed: {} }
  const nowIds = new Set(now.map((f) => f.id))
  const prevIds = new Set(previous.findings.map((f) => f.id))
  // Runs stored before needsInput was excluded may still hold coach homework: still open, never «fixed».
  const homeworkIds = new Set(openRuleFindings(current).filter((f) => f.needsInput).map((f) => f.id))
  const fixed = previous.findings.filter((f) => !nowIds.has(f.id) && !homeworkIds.has(f.id))
  const added = now.filter((f) => !prevIds.has(f.id))
  const remaining = now.filter((f) => prevIds.has(f.id))
  const changed: Record<string, SelfCheckChange> = {}
  const pairKey = (f: SelfCheckFinding) => `${f.ruleId}|${f.targets[0] ?? ''}`
  const pairable = (a: SelfCheckFinding, b: SelfCheckFinding) => a.targets.length <= 1 || b.targets.length <= 1
  const pool = new Map<string, SelfCheckFinding[]>()
  for (const f of fixed) pool.set(pairKey(f), [...(pool.get(pairKey(f)) ?? []), f])
  const pairedBefore = new Set<string>()
  const stillAdded: SelfCheckFinding[] = []
  for (const f of added) {
    const candidates = pool.get(pairKey(f)) ?? []
    const index = candidates.findIndex((b) => pairable(b, f))
    if (index < 0) {
      stillAdded.push(f)
      continue
    }
    const before = candidates.splice(index, 1)[0]!
    pairedBefore.add(before.id)
    changed[f.id] = { before, now: f, severityChanged: before.severity !== f.severity }
    remaining.push(f)
  }
  return { fixed: fixed.filter((f) => !pairedBefore.has(f.id)), remaining, added: stillAdded, changed }
}

// ---- grouping (report + progress list) ----------------------------------------------------------

const dayNumber = (d: IsoDate): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000

/**
 * Compact German date list: «24.–30.01.2031» for a run of 3+ consecutive days, otherwise
 * «26., 27., 29., 30.01.2031» (months separate segments: «30.01., 02.02.2031»). Input need not be sorted.
 */
export function formatDateList(dates: readonly IsoDate[]): string {
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 0) return ''
  const dd = (d: IsoDate) => d.slice(8, 10)
  const mm = (d: IsoDate) => d.slice(5, 7)
  const yy = (d: IsoDate) => d.slice(0, 4)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (sorted.length >= 3 && dayNumber(last) - dayNumber(first) === sorted.length - 1) {
    return mm(first) === mm(last) && yy(first) === yy(last)
      ? `${dd(first)}.–${dd(last)}.${mm(first)}.${yy(first)}`
      : `${dd(first)}.${mm(first)}.${yy(first) === yy(last) ? '' : yy(first)}–${dd(last)}.${mm(last)}.${yy(last)}`
  }
  const sameYear = sorted.every((d) => yy(d) === yy(first))
  const segments: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && mm(sorted[j]!) === mm(sorted[i]!) && yy(sorted[j]!) === yy(sorted[i]!)) j++
    const part = sorted.slice(i, j)
    const tail = sameYear ? '' : yy(part[0]!)
    segments.push(`${part.map((d) => `${dd(d)}.`).join(', ')}${mm(part[0]!)}.${tail}`)
    i = j
  }
  return sameYear ? `${segments.join(', ')}${yy(first)}` : segments.join(', ')
}

/** Dates of the camp days a finding points at; null unless every target is a camp day. */
function dayDatesOf(targets: readonly string[], facts: CampFacts | null): IsoDate[] | null {
  if (!facts || targets.length === 0) return null
  const dates: IsoDate[] = []
  for (const t of targets) {
    const day = facts.days.find((d) => d.iri === t)
    if (!day) return null
    dates.push(day.date)
  }
  return dates
}

export interface SelfCheckRuleGroup<T> {
  ruleId: string
  severity: Severity
  title: string
  items: T[]
  /** Ascending, unique; empty for single (ungrouped) entries. */
  dates: IsoDate[]
  /** True when several day findings of one rule were merged. */
  merged: boolean
}

const SEVERITY_RANK: Record<Severity, number> = { must: 0, should: 1, hint: 2 }

/**
 * Merges the day-scoped findings of one rule (>= 2) into one group; everything else stays a group of
 * one. Keeps the order of first appearance; the items of a merged group are sorted by date. A merged
 * group takes the most severe severity of its items (a Muss is never hidden behind a Hinweis).
 */
export function groupSelfCheckFindings<T extends Pick<SelfCheckFinding, 'ruleId' | 'severity' | 'title' | 'targets'>>(
  items: readonly T[],
  facts: CampFacts | null,
): SelfCheckRuleGroup<T>[] {
  const dayItems = new Map<string, { item: T; dates: IsoDate[] }[]>()
  const isDayItem = new Set<T>()
  for (const item of items) {
    const dates = dayDatesOf(item.targets, facts)
    if (!dates) continue
    isDayItem.add(item)
    dayItems.set(item.ruleId, [...(dayItems.get(item.ruleId) ?? []), { item, dates }])
  }
  const out: SelfCheckRuleGroup<T>[] = []
  const done = new Set<string>()
  for (const item of items) {
    const list = dayItems.get(item.ruleId)
    // Only the rule's day items merge; a camp or activity item of the same rule stays its own entry.
    if (list && list.length >= 2 && isDayItem.has(item)) {
      if (done.has(item.ruleId)) continue
      done.add(item.ruleId)
      const sorted = [...list].sort((a, b) => (a.dates[0]! < b.dates[0]! ? -1 : a.dates[0]! > b.dates[0]! ? 1 : 0))
      out.push({
        ruleId: item.ruleId,
        severity: list.reduce<Severity>((acc, x) => (SEVERITY_RANK[x.item.severity] < SEVERITY_RANK[acc] ? x.item.severity : acc), item.severity),
        title: item.title,
        items: sorted.map((x) => x.item),
        dates: [...new Set(sorted.flatMap((x) => x.dates))].sort(),
        merged: true,
      })
    } else {
      out.push({ ruleId: item.ruleId, severity: item.severity, title: item.title, items: [item], dates: [], merged: false })
    }
  }
  return out
}

/** «an {n} Tagen ({dates})» for a merged day group. */
export function daysLabel(dates: readonly IsoDate[]): string {
  return tr('selfCheck.report.days', { n: dates.length, dates: formatDateList(dates) })
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
  /** All findings merged into this item (one for single items). */
  findingIds: string[]
  /** Dates of a merged day group («an 7 Tagen (…)» is already in `message`); empty otherwise. */
  dates: IsoDate[]
}

export interface SelfCheckReportGroup {
  severity: Severity
  /** «Hinweis (6 Themen, 19 Stellen)»; plain «Hinweis (n)» when every topic has one place. */
  header: string
  /** Number of report items (topics) and of findings (places) in this group. */
  topics: number
  places: number
  items: SelfCheckReportItem[]
}

/** J+S days of the report; `required` (minimum) colours the chip like the Übersicht tile. */
export interface SelfCheckJsDays {
  valid: number
  total: number
  required?: number
}

export interface SelfCheckReportModel {
  heading: string
  counts: { must: number; should: number; hint: number }
  /** Null while the category mapping is unconfirmed (provisional) or without data. */
  jsDays: SelfCheckJsDays | null
  groups: SelfCheckReportGroup[]
  /** «Behoben seit letztem Selbstcheck»: title plus the old message; a merged day group is one entry («an 7 Tagen (…)»). */
  fixed: { id: string; title: string; message: string; findingIds: string[] }[]
  /** Heading of the fixed list, counted like the group headers: «(n)» or «(1 Thema, 7 Stellen)». */
  fixedHeader: string
  /** Mapping not confirmed yet: J+S days and day rules were not checked (printed as first line). */
  provisional: boolean
}

/** Structured report (open findings grouped Muss / Soll / Hinweis, fixed list). Pure. */
export function buildSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: SelfCheckJsDays | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
  provisional = false,
): SelfCheckReportModel {
  const include = opts.includeRedDerived === true
  // Coach homework (needsInput) is the coach's own to-do, not something the leaders can act on.
  const visible = openRuleFindings(findings).filter((f) => !f.needsInput && (include || !isRedDerived(f)))
  const linkFacts = { ...facts, instanceBaseUrl: opts.instanceBaseUrl }
  const count = (sev: Severity) => visible.filter((f) => f.severity === sev).length
  const groups: SelfCheckReportGroup[] = []
  // Activity block number («1.10» after «1.2»); findings without a number sort after numbered ones.
  const numbers = new Map<string, string>()
  for (const f of visible) {
    const t = findingTarget(f, facts)
    numbers.set(f.id, (t.kind === 'activity' ? t.number : null) ?? '￿')
  }
  const numberKey = (f: Finding): string => numbers.get(f.id) ?? '￿'
  for (const severity of SEVERITY_ORDER) {
    const sevFindings = visible
      .filter((f) => f.severity === severity)
      .sort(
        (a, b) =>
          a.ruleId.localeCompare(b.ruleId) ||
          numberKey(a).localeCompare(numberKey(b), 'de', { numeric: true }) ||
          a.id.localeCompare(b.id),
      )
    if (sevFindings.length === 0) continue
    const items = groupSelfCheckFindings(sevFindings, facts).flatMap((g): SelfCheckReportItem[] => {
      if (g.merged) {
        const first = g.items[0]!
        return [{ findingId: first.id, title: g.title, message: daysLabel(g.dates), activityLabel: null, url: null, findingIds: g.items.map((f) => f.id), dates: g.dates }]
      }
      const f = g.items[0]!
      const actIri = activityIriOfFinding(f, facts)
      return [
        {
          findingId: f.id,
          title: f.title,
          message: f.message,
          activityLabel: actIri ? activityLabel(facts, actIri) : null,
          url: actIri && opts.instanceBaseUrl ? ecampActivityUrl(linkFacts, actIri) : null,
          findingIds: [f.id],
          dates: [],
        },
      ]
    })
    const topics = items.length
    const places = sevFindings.length
    const label = tr(`selfCheck.kpi.${severity}`)
    const header =
      topics === places
        ? tr(`selfCheck.report.group.${severity}`, { n: places })
        : tr(topics === 1 ? 'selfCheck.report.groupCountOne' : 'selfCheck.report.groupCount', { label, topics, places })
    groups.push({ severity, header, topics, places, items })
  }
  // Fixed day findings of one rule merge like the open ones: one entry per topic («an 7 Tagen (…)»).
  // The heading counts like the group headers: «(n)» when every topic has one place, else topics and places.
  const fixed = progress
    ? groupSelfCheckFindings(
        progress.fixed.filter((f) => include || !f.redDerived),
        facts,
      ).map((g) => {
        const first = g.items[0]!
        return { id: first.id, title: g.title, message: g.merged ? daysLabel(g.dates) : first.message, findingIds: g.items.map((f) => f.id) }
      })
    : []
  const fixedTopics = fixed.length
  const fixedPlaces = fixed.reduce((n, f) => n + f.findingIds.length, 0)
  const fixedHeader =
    fixedTopics === fixedPlaces
      ? tr('selfCheck.report.fixedHeading', { n: fixedTopics })
      : tr(fixedTopics === 1 ? 'selfCheck.report.fixedHeadingCountOne' : 'selfCheck.report.fixedHeadingCount', { topics: fixedTopics, places: fixedPlaces })
  return {
    heading: tr('selfCheck.report.heading', { camp: facts.camp.title, date: formatDate(opts.now) }),
    counts: { must: count('must'), should: count('should'), hint: count('hint') },
    // Provisional: the day count would contradict «nicht geprüft».
    jsDays: provisional ? null : jsDays,
    groups,
    fixed,
    fixedHeader,
    provisional,
  }
}

function countsLine(m: SelfCheckReportModel): string {
  return tr('selfCheck.report.counts', m.counts)
}
function provisionalLine(m: SelfCheckReportModel): string | null {
  return m.provisional ? tr('selfCheck.report.provisional') : null
}
function fixedText(f: { title: string; message: string }): string {
  return f.message ? `${f.title} – ${f.message}` : f.title
}
function jsDaysLine(m: SelfCheckReportModel): string | null {
  return m.jsDays ? tr('selfCheck.report.jsDays', { valid: m.jsDays.valid, total: m.jsDays.total }) : null
}

/** Plain-text report (German) from the model; the eCamp URL follows the activity label in parentheses. */
export function renderSelfCheckReportText(m: SelfCheckReportModel): string {
  const lines: string[] = [m.heading]
  const prov = provisionalLine(m)
  if (prov) lines.push(prov)
  lines.push(countsLine(m))
  const js = jsDaysLine(m)
  if (js) lines.push(js)
  for (const g of m.groups) {
    lines.push('', g.header)
    for (const it of g.items) {
      const label = it.activityLabel ? `${it.activityLabel}${it.url ? ` (${it.url})` : ''}: ` : ''
      lines.push(`- ${label}${it.title}: ${it.message}`)
    }
  }
  if (m.groups.length === 0) lines.push('', tr('selfCheck.report.none'))
  if (m.fixed.length > 0) {
    lines.push('', m.fixedHeader)
    for (const f of m.fixed) lines.push(`- ${fixedText(f)}`)
  }
  return lines.join('\n') + '\n'
}

/** Mail-friendly HTML: the activity label (or the title) is the link, no raw URL is visible. */
export function renderSelfCheckReportHtml(m: SelfCheckReportModel): string {
  const parts: string[] = [`<h3>${escapeHtml(m.heading)}</h3>`]
  const js = jsDaysLine(m)
  const prov = provisionalLine(m)
  if (prov) parts.push(`<p><strong>${escapeHtml(prov)}</strong></p>`)
  parts.push(`<p>${escapeHtml(countsLine(m))}${js ? `<br>${escapeHtml(js)}` : ''}</p>`)
  for (const g of m.groups) {
    parts.push(`<h4>${escapeHtml(g.header)}</h4>`, '<ul>')
    for (const it of g.items) {
      const link = (text: string) => (it.url ? `<a href="${escapeHtml(it.url)}">${escapeHtml(text)}</a>` : escapeHtml(text))
      const head = it.activityLabel ? `${link(it.activityLabel)}: ${escapeHtml(it.title)}` : link(it.title)
      parts.push(`<li>${head}: ${escapeHtml(it.message)}</li>`)
    }
    parts.push('</ul>')
  }
  if (m.groups.length === 0) parts.push(`<p>${escapeHtml(tr('selfCheck.report.none'))}</p>`)
  if (m.fixed.length > 0) {
    parts.push(`<h4>${escapeHtml(m.fixedHeader)}</h4>`, '<ul>')
    for (const f of m.fixed) parts.push(`<li>${escapeHtml(fixedText(f))}</li>`)
    parts.push('</ul>')
  }
  return parts.join('\n')
}

/** Plain-text report for the clipboard (built from the model). */
export function renderSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: SelfCheckJsDays | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
  provisional = false,
): string {
  return renderSelfCheckReportText(buildSelfCheckReport(facts, findings, jsDays, progress, opts, provisional))
}
