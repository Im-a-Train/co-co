/**
 * Triage ("Befunde durchgehen"): pure helpers for status derivation, navigation and routing.
 * No Vue / Dexie here so everything is unit-testable.
 */
import type { CampFacts, FeedbackItem, Finding, IsoDate, Iri, Severity } from '../types'
import { campIdFromIri } from '../iri'

export type FindingStatus = 'open' | 'feedback' | 'ignored'

/** True when `item` was created for `finding` (findingId wins; else ruleId + target). */
export function feedbackMatchesFinding(item: FeedbackItem, finding: Finding): boolean {
  if (item.findingIds?.length) return item.findingIds.includes(finding.id)
  if (item.findingId) return item.findingId === finding.id
  if (!item.ruleId || item.ruleId !== finding.ruleId) return false
  if (item.scope === 'activity') return !!item.activityIri && finding.targets.includes(item.activityIri)
  return finding.scope !== 'activity'
}

export function feedbackForFinding(finding: Finding, items: readonly FeedbackItem[]): FeedbackItem | null {
  return items.find((i) => feedbackMatchesFinding(i, finding)) ?? null
}

/** Ignored beats feedback beats open. Derived, so it stays consistent with the Feedback tab. */
export function findingStatus(finding: Finding, items: readonly FeedbackItem[]): FindingStatus {
  if (finding.override) return 'ignored'
  return feedbackForFinding(finding, items) ? 'feedback' : 'open'
}

export function statusesOf(findings: readonly Finding[], items: readonly FeedbackItem[]): FindingStatus[] {
  return findings.map((f) => findingStatus(f, items))
}

/** Next open index after `from`, cyclic (wraps around). `from` itself is never returned. -1 if none. */
export function nextOpenIndex(statuses: readonly FindingStatus[], from: number): number {
  const n = statuses.length
  for (let step = 1; step < n; step++) {
    const i = (from + step + n) % n
    if (statuses[i] === 'open') return i
  }
  return -1
}

/** Plain next/previous with wrap-around (J/K). */
export function stepIndex(length: number, index: number, dir: 1 | -1): number {
  if (length <= 0) return -1
  return (((index + dir) % length) + length) % length
}

export interface TriageProgress {
  done: number
  total: number
  open: number
}

export function progressOf(statuses: readonly FindingStatus[]): TriageProgress {
  const open = statuses.filter((s) => s === 'open').length
  return { done: statuses.length - open, total: statuses.length, open }
}

/** Index of the finding with `key`, or a clamped fallback when it vanished; -1 for an empty list. */
export function resolveIndex(findings: readonly Finding[], key: string | null | undefined, fallbackIndex = 0): number {
  if (!findings.length) return -1
  const i = key ? findings.findIndex((f) => f.id === key) : -1
  if (i >= 0) return i
  return Math.min(Math.max(fallbackIndex, 0), findings.length - 1)
}

/** Route location that opens the triage of a camp at a finding (used by Übersicht and Raster). */
export function triageLocation(campIri: Iri, findingId: string, opts: { editor?: boolean } = {}) {
  return {
    name: 'camp-findings',
    params: { campId: campIdFromIri(campIri) },
    query: { befund: findingId, ...(opts.editor ? { editor: '1' } : {}) },
  }
}

/** Last triage position per camp (in memory; survives navigation between tabs). */
const positions = new Map<string, string>()
export function rememberPosition(campIri: Iri, findingId: string): void {
  positions.set(campIri, findingId)
}
export function recallPosition(campIri: Iri): string | null {
  return positions.get(campIri) ?? null
}
export function forgetPositions(): void {
  positions.clear()
}

/** The activity a finding is about (own target, a schedule entry's activity, or activity evidence). */
export function activityIriOfFinding(finding: Finding, facts: CampFacts | null): Iri | null {
  if (!facts) return null
  const isActivity = (iri: string) => facts.activities.some((a) => a.iri === iri)
  for (const t of finding.targets) {
    if (isActivity(t)) return t
    const entry = facts.scheduleEntries.find((e) => e.iri === t)
    if (entry?.activityIri) return entry.activityIri
  }
  for (const e of finding.evidence) {
    if (e.iri && isActivity(e.iri)) return e.iri
    const entry = e.iri ? facts.scheduleEntries.find((x) => x.iri === e.iri) : undefined
    if (entry?.activityIri) return entry.activityIri
  }
  return null
}

// ---- Befund -> Raster -> zurück zum Befund ---------------------------------------------------------

export interface FindingOrigin {
  findingId: string
  /** Befunde was in list mode (otherwise triage). */
  list: boolean
  /** Activity filter that was active in Befunde, if any. */
  filterActivity: Iri | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Route location for the grid, remembering which finding we came from. With `opts.dayIri` (day
 * findings) the grid gets `tag=<dayIri>` to highlight that day and opens no activity drawer;
 * otherwise `activity` opens the activity.
 */
export function gridLocationFromFinding(
  campIri: Iri,
  findingId: string,
  activityIri: Iri | null,
  opts: { list?: boolean; filterActivity?: Iri | null; dayIri?: Iri | null } = {},
) {
  return {
    name: 'camp-grid',
    params: { campId: campIdFromIri(campIri) },
    query: {
      ...(opts.dayIri ? { tag: opts.dayIri } : activityIri ? { activity: activityIri } : {}),
      vonBefund: findingId,
      ...(opts.list ? { vonAnsicht: 'liste' } : {}),
      ...(opts.filterActivity ? { vonFilter: opts.filterActivity } : {}),
    },
  }
}

/** The finding the grid was opened from (null when the grid was opened normally). */
export function originFromQuery(query: Record<string, unknown>): FindingOrigin | null {
  const findingId = str(query.vonBefund)
  if (!findingId) return null
  return { findingId, list: query.vonAnsicht === 'liste', filterActivity: str(query.vonFilter) }
}

/** Route location of the Befunde tab exactly as it was left (same finding, mode and filter). */
export function backToFindingLocation(campIri: Iri, origin: FindingOrigin) {
  const query: Record<string, string> = { befund: origin.findingId }
  if (origin.list) query.ansicht = 'liste'
  if (origin.filterActivity) query.activity = origin.filterActivity
  return { name: 'camp-findings', params: { campId: campIdFromIri(campIri) }, query }
}

/**
 * True when the previous history entry (`history.state.back`, a full path) already is the
 * Befunde location we want to return to, so router.back() lands there without a new entry.
 */
export function previousEntryIsOrigin(previousFullPath: string | null | undefined, campIri: Iri, origin: FindingOrigin): boolean {
  if (!previousFullPath) return false
  const [path = '', qs = ''] = previousFullPath.split('?')
  if (!path.endsWith(`/lager/${campIdFromIri(campIri)}/befunde`)) return false
  const q = new URLSearchParams(qs)
  if (q.get('befund') !== origin.findingId) return false
  if ((q.get('ansicht') === 'liste') !== origin.list) return false
  return (q.get('activity') || null) === origin.filterActivity
}

// ---- Coach homework, targets and grouping ------------------------------------------------------------

/** A finding that waits for an input from the coach (never feedback for the leaders). */
export function isCoachTodo(f: Finding): boolean {
  return !!f.needsInput
}

/** The day a finding is about: the first target that is a day of the camp (null without facts). */
export function dayIriOfFinding(f: Finding, facts: CampFacts | null): Iri | null {
  if (!facts) return null
  return f.targets.find((t) => facts.days.some((d) => d.iri === t)) ?? null
}

export type FindingTarget =
  | { kind: 'day'; dayIri: Iri; date: IsoDate }
  | { kind: 'activity'; activityIri: Iri; number: string | null; title: string; date: IsoDate | null }
  | { kind: 'camp' }
  | { kind: 'document'; documentId: string }

/**
 * What a finding is about, for the triage subtitle («Mi 29.01.» / «1.1 Skifahren» / «Lager»).
 * Camp findings are always «Lager»; a schedule-entry finding names its own block, an activity finding
 * the activity's first block. Dates are camp-local calendar dates (never converted).
 */
export function findingTarget(f: Finding, facts: CampFacts | null): FindingTarget {
  if (f.scope === 'document' && f.targets[0]) return { kind: 'document', documentId: f.targets[0] }
  if (!facts || f.scope === 'camp') return { kind: 'camp' }
  const dayIri = dayIriOfFinding(f, facts)
  const day = dayIri ? facts.days.find((d) => d.iri === dayIri) : undefined
  if (day && f.scope === 'day') return { kind: 'day', dayIri: day.iri, date: day.date }
  const activityIri = activityIriOfFinding(f, facts)
  if (activityIri) {
    const activity = facts.activities.find((a) => a.iri === activityIri)
    const entries = facts.scheduleEntries.filter((e) => e.activityIri === activityIri)
    const own = entries.find((e) => f.targets.includes(e.iri))
    const entry = own ?? [...entries].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))[0]
    const entryDay = entry?.dayIri ? facts.days.find((d) => d.iri === entry.dayIri) : undefined
    return {
      kind: 'activity',
      activityIri,
      number: entry?.number ?? null,
      title: activity?.title ?? '',
      // `start` is camp-local wall-clock time (+00:00): its date part is the calendar date.
      date: entryDay?.date ?? (entry ? entry.start.slice(0, 10) : null),
    }
  }
  if (day) return { kind: 'day', dayIri: day.iri, date: day.date }
  return { kind: 'camp' }
}

export interface FindingGroupEntry {
  key: string
  ruleId: string
  severity: Severity
  /** Sorted by date / block number; single findings are groups of one. */
  findings: Finding[]
  /** Ascending, unique camp-local dates the entry is about (day targets, else the block's day; empty when unknown). */
  dates: IsoDate[]
}

const SEVERITY_RANK: Record<Severity, number> = { must: 0, should: 1, hint: 2 }

function findingDates(f: Finding, facts: CampFacts | null): IsoDate[] {
  if (!facts) return []
  if (f.scope === 'day') {
    return f.targets.flatMap((t) => facts.days.filter((d) => d.iri === t).map((d) => d.date))
  }
  const t = findingTarget(f, facts)
  if (t.kind === 'day') return [t.date]
  if (t.kind === 'activity' && t.date) return [t.date]
  return []
}

const byNumber = (a: string | null, b: string | null): number =>
  (a ?? '\uffff').localeCompare(b ?? '\uffff', 'de', { numeric: true })

/** Order of entries of one rule: severity first (engine order), then date, then block number. */
function compareEntries(a: FindingGroupEntry, b: FindingGroupEntry, facts: CampFacts | null): number {
  const da = a.dates[0] ?? '\uffff'
  const db = b.dates[0] ?? '\uffff'
  const numberOf = (e: FindingGroupEntry) => {
    const t = e.findings.length === 1 && e.findings[0] ? findingTarget(e.findings[0], facts) : null
    return t?.kind === 'activity' ? t.number : null
  }
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (da < db ? -1 : da > db ? 1 : 0) || byNumber(numberOf(a), numberOf(b))
}

/**
 * Groups same-rule DAY findings (scope `day`, at least two) into one entry; activity, camp and other
 * findings stay single. Entries keep the order of first appearance, except that adjacent entries of
 * the same rule are sorted by date / block number (the engine orders them by hash id). A Muss is never
 * hidden: the group takes the most severe severity of its findings.
 */
export function groupFindings(findings: readonly Finding[], facts: CampFacts | null): FindingGroupEntry[] {
  const dayByRule = new Map<string, Finding[]>()
  for (const f of findings) {
    if (f.scope !== 'day') continue
    const list = dayByRule.get(f.ruleId) ?? []
    list.push(f)
    dayByRule.set(f.ruleId, list)
  }
  const entries: FindingGroupEntry[] = []
  const emitted = new Set<string>()
  for (const f of findings) {
    const grouped = f.scope === 'day' && (dayByRule.get(f.ruleId)?.length ?? 0) >= 2
    if (grouped) {
      if (emitted.has(f.ruleId)) continue
      emitted.add(f.ruleId)
      const members = (dayByRule.get(f.ruleId) ?? []).map((m) => ({ m, d: findingDates(m, facts)[0] ?? '' }))
      members.sort((a, b) => (a.d === b.d ? 0 : !a.d ? 1 : !b.d ? -1 : a.d < b.d ? -1 : 1))
      const sorted = members.map((x) => x.m)
      const dates = [...new Set(sorted.flatMap((m) => findingDates(m, facts)))].sort()
      const severity = sorted.reduce<Severity>((acc, m) => (SEVERITY_RANK[m.severity] < SEVERITY_RANK[acc] ? m.severity : acc), f.severity)
      entries.push({ key: `group:${f.ruleId}`, ruleId: f.ruleId, severity, findings: sorted, dates })
    } else {
      entries.push({ key: f.id, ruleId: f.ruleId, severity: f.severity, findings: [f], dates: findingDates(f, facts) })
    }
  }
  // Sort each run of adjacent same-rule entries (stable; other entries keep their position).
  const out: FindingGroupEntry[] = []
  for (let i = 0; i < entries.length; ) {
    let j = i + 1
    while (j < entries.length && entries[j]!.ruleId === entries[i]!.ruleId) j++
    out.push(...entries.slice(i, j).sort((a, b) => compareEntries(a, b, facts)))
    i = j
  }
  return out
}
