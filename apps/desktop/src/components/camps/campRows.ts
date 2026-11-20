/** Pure row model for "Meine Lager" (list entry + summary + review + deadlines + rounds). */
import { addMonths, archiveDeadlines, computeDeadlines, isArchivedCamp } from '@/domain/rules/lib/deadlines'
import type {
  CampListEntry,
  CampProgressSummary,
  CampSummaryRecord,
  CoachInputs,
  CollaboratorRole,
  Deadline,
  FindingCounts,
  Iri,
  IsoDate,
  ReviewState,
  ReviewStatus,
  Round,
} from '@/domain/types'

export interface CampRow {
  iri: Iri
  id: string
  title: string
  motto: string | null
  start: IsoDate | null
  end: IsoDate | null
  role: CollaboratorRole | null
  review: ReviewStatus
  /** null = never evaluated. */
  counts: FindingCounts | null
  nextDeadline: Deadline | null
  /** Start of the latest round (changes are measured since then), null without rounds. */
  lastRoundAt: string | null
  /** Number of the latest round, null without rounds. */
  lastRoundNumber: number | null
  /** Review progress persisted by the Übersicht; null when the camp was never opened. */
  progress: CampProgressSummary | null
  /** Ended more than a month ago: deadlines no longer alarm (same rule as «Fristen»). */
  archived: boolean
  isPrototype: boolean
}

export interface CampRowSources {
  summaries: CampSummaryRecord[]
  reviews: ReviewState[]
  rounds: Round[]
  inputs: CoachInputs[]
}

const todayIso = (): IsoDate => new Date().toISOString().slice(0, 10)

export function buildCampRows(entries: CampListEntry[], src: CampRowSources, today: IsoDate = todayIso()): CampRow[] {
  const summaries = new Map(src.summaries.map((s) => [s.campIri, s]))
  const reviews = new Map(src.reviews.map((r) => [r.campIri, r]))
  const inputs = new Map(src.inputs.map((i) => [i.campIri, i]))
  const lastRound = new Map<Iri, Round>()
  for (const r of src.rounds) {
    const prev = lastRound.get(r.campIri)
    if (!prev || r.startedAt > prev.startedAt) lastRound.set(r.campIri, r)
  }
  return entries.map((e) => {
    const summary = summaries.get(e.iri) ?? null
    const deadlines = archiveDeadlines(
      computeDeadlines(
        { iri: e.iri, title: e.title, start: e.start, end: e.end, lastJsDate: summary?.lastJsDate ?? null },
        inputs.get(e.iri) ?? null,
      ),
      { [e.iri]: e.end ?? e.start },
      today,
    )
    return {
      iri: e.iri,
      id: e.id,
      title: e.title,
      motto: e.motto,
      start: e.start,
      end: e.end,
      role: e.role,
      review: reviews.get(e.iri)?.status ?? 'neu',
      counts: summary?.counts ?? null,
      nextDeadline: nextOpenDeadline(deadlines),
      lastRoundAt: lastRound.get(e.iri)?.startedAt ?? null,
      lastRoundNumber: lastRound.get(e.iri)?.number ?? null,
      progress: summary?.progress ?? null,
      archived: isArchivedCamp(e.end ?? e.start, today),
      isPrototype: e.isPrototype,
    }
  })
}

/** Earliest deadline that is not done yet (overdue ones come first naturally). */
export function nextOpenDeadline(deadlines: Deadline[]): Deadline | null {
  const open = deadlines.filter((d) => !d.done).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
  return open[0] ?? null
}

/** `YYYY-MM-DD` (or ISO date-time) -> `DD.MM.YYYY`; '–' when missing. */
export function formatIsoDate(v: string | null | undefined): string {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–'
}

/** Case-insensitive search over title, motto and role. */
export function filterCampRows(rows: CampRow[], query: string): CampRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => [r.title, r.motto ?? '', r.role ?? ''].some((s) => s.toLowerCase().includes(q)))
}

/**
 * Running camps first, then upcoming ones (start ascending, undated last), then ended ones (end descending).
 * Ties fall back to the title.
 */
export function sortCampRows(rows: CampRow[], today: IsoDate = todayIso()): CampRow[] {
  const rank = (r: CampRow): number => {
    const p = campPhase(r, today)
    return p === 'running' ? 0 : p === 'upcoming' ? 1 : 2
  }
  return [...rows].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 2) {
      const ea = a.end ?? a.start ?? ''
      const eb = b.end ?? b.start ?? ''
      if (ea !== eb) return ea < eb ? 1 : -1
      return a.title.localeCompare(b.title)
    }
    if (a.start === b.start) return a.title.localeCompare(b.title)
    if (!a.start) return 1
    if (!b.start) return -1
    return a.start < b.start ? -1 : 1
  })
}

export type CampPhase = 'upcoming' | 'running' | 'ended' | 'old'

/** Phase relative to `today`: ended = end < today, old = ended more than 3 months ago; no dates = upcoming. */
export function campPhase(row: Pick<CampRow, 'start' | 'end'>, today: IsoDate): CampPhase {
  const end = row.end ?? row.start
  if (!end) return 'upcoming'
  if (end < today) return today > addMonths(end, 3) ? 'old' : 'ended'
  if (row.start && row.start > today) return 'upcoming'
  return row.start ? 'running' : 'upcoming'
}

export interface CampPhaseFilter {
  showEnded: boolean
}

/** Default view: upcoming + running; ended camps (including old ones) only when switched on. */
export function filterCampsByPhase(rows: CampRow[], filter: CampPhaseFilter, today: IsoDate): CampRow[] {
  return filter.showEnded ? rows : rows.filter((r) => campPhase(r, today) !== 'ended' && campPhase(r, today) !== 'old')
}

/** Number of ended (or old) camps, for the switch label. */
export function endedCount(rows: CampRow[], today: IsoDate): number {
  return rows.filter((r) => {
    const p = campPhase(r, today)
    return p === 'ended' || p === 'old'
  }).length
}

/** Text key (under `camps.campsView.next`) and params of the «Als Nächstes» column. */
export interface CampNext {
  key: 'mapping' | 'inputs' | 'triage' | 'documents' | 'checklist' | 'feedback' | 'status' | 'done' | 'never' | 'waiting' | 'waitingSince'
  params: Record<string, string | number>
}

export function campNext(row: Pick<CampRow, 'progress' | 'review' | 'lastRoundAt' | 'lastRoundNumber'>): CampNext {
  // Approved: the review is finished, like the Übersicht (no next step after «Bewilligt»).
  if (row.review === 'bewilligt' || row.review === 'bewilligt_mit_auflagen') return { key: 'done', params: {} }
  if (row.review === 'aenderungen_angefragt') {
    if (row.lastRoundNumber != null && row.lastRoundAt) {
      return { key: 'waitingSince', params: { n: row.lastRoundNumber, date: formatIsoDate(row.lastRoundAt) } }
    }
    return { key: 'waiting', params: {} }
  }
  const p = row.progress
  if (!p) return { key: 'never', params: {} }
  if (p.nextStep === null) return { key: 'done', params: {} }
  const key = p.nextStep as CampNext['key']
  return { key, params: key === 'triage' ? { n: p.triageOpen } : {} }
}

export type FindingsTone = 'error' | 'warning' | 'info' | 'neutral'

/** Findings as text parts («2 Muss · 5 Soll · 17 Hinweise»); empty buckets are left out. */
export function findingsText(counts: FindingCounts | null): { must: number; should: number; hint: number; tone: FindingsTone } | null {
  if (!counts) return null
  const tone: FindingsTone = counts.must > 0 ? 'error' : counts.should > 0 ? 'warning' : counts.hint > 0 ? 'info' : 'neutral'
  return { must: counts.must, should: counts.should, hint: counts.hint, tone }
}

/** Approved camp that still has an open Muss finding. */
export function approvedWithOpenMust(row: Pick<CampRow, 'review' | 'counts'>): number {
  return (row.review === 'bewilligt' || row.review === 'bewilligt_mit_auflagen') && row.counts && row.counts.must > 0 ? row.counts.must : 0
}
