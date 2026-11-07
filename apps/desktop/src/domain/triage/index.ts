/**
 * Triage ("Befunde durchgehen"): pure helpers for status derivation, navigation and routing.
 * No Vue / Dexie here so everything is unit-testable.
 */
import type { CampFacts, FeedbackItem, Finding, Iri } from '../types'
import { campIdFromIri } from '../iri'

export type FindingStatus = 'open' | 'feedback' | 'ignored'

/** True when `item` was created for `finding` (findingId wins; else ruleId + target). */
export function feedbackMatchesFinding(item: FeedbackItem, finding: Finding): boolean {
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

/** Route location for the grid with the activity open, remembering which finding we came from. */
export function gridLocationFromFinding(
  campIri: Iri,
  findingId: string,
  activityIri: Iri,
  opts: { list?: boolean; filterActivity?: Iri | null } = {},
) {
  return {
    name: 'camp-grid',
    params: { campId: campIdFromIri(campIri) },
    query: {
      activity: activityIri,
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
