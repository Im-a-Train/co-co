/** Pure row model for "Meine Lager" (list entry + summary + review + deadlines + rounds). */
import { addMonths, computeDeadlines } from '@/domain/rules/deadlines'
import type {
  CampListEntry,
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
  isPrototype: boolean
}

export interface CampRowSources {
  summaries: CampSummaryRecord[]
  reviews: ReviewState[]
  rounds: Round[]
  inputs: CoachInputs[]
}

export function buildCampRows(entries: CampListEntry[], src: CampRowSources): CampRow[] {
  const summaries = new Map(src.summaries.map((s) => [s.campIri, s]))
  const reviews = new Map(src.reviews.map((r) => [r.campIri, r]))
  const inputs = new Map(src.inputs.map((i) => [i.campIri, i]))
  const lastRound = new Map<Iri, string>()
  for (const r of src.rounds) {
    const prev = lastRound.get(r.campIri)
    if (!prev || r.startedAt > prev) lastRound.set(r.campIri, r.startedAt)
  }
  return entries.map((e) => {
    const summary = summaries.get(e.iri) ?? null
    const deadlines = computeDeadlines(
      { iri: e.iri, title: e.title, start: e.start, end: e.end, lastJsDate: summary?.lastJsDate ?? null },
      inputs.get(e.iri) ?? null,
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
      lastRoundAt: lastRound.get(e.iri) ?? null,
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

/** Upcoming camps first (by start), camps without dates last. */
export function sortCampRows(rows: CampRow[]): CampRow[] {
  return [...rows].sort((a, b) => {
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
  showOld: boolean
}

/** Default view: upcoming + running; ended / old camps only when switched on. */
export function filterCampsByPhase(rows: CampRow[], filter: CampPhaseFilter, today: IsoDate): CampRow[] {
  return rows.filter((r) => {
    const p = campPhase(r, today)
    return p === 'ended' ? filter.showEnded : p === 'old' ? filter.showOld : true
  })
}
