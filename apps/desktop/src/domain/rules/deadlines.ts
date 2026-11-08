/**
 * Deadlines across camps. Pure.
 * NDS registration T-30 (JS-DL-01), NDS closing T+30 after last J+S activity (JS-DL-02),
 * Leihmaterial T-5w, Landeskarten T-3w (T-5w when the camp starts in Jun-Aug) (JS-DL-03),
 * Lagerbewilligung T-21.
 */
import type { CoachInputs, Deadline, DeadlineKind, Iri, IsoDate, Source } from '../types'

export interface DeadlineCamp {
  iri: Iri
  title: string
  start: IsoDate | null
  end: IsoDate | null
  /** Date of the last J+S unit if known (from CampFacts), else camp end is used. */
  lastJsDate?: IsoDate | null
}

export const SOURCE_JS_LAGER: Source = { title: 'J+S Lager', url: 'https://www.jugendundsport.ch/de/lager' }
export const SOURCE_COACH: Source = { title: 'Leitfaden Coach', url: 'https://www.jugendundsport.ch/de/leitfaden-coach' }

/** Adds (or subtracts) calendar days to a `YYYY-MM-DD` date (UTC arithmetic, DST-safe). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const t = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((t(b) - t(a)) / 86400000)
}

/** Landeskarten need 3 weeks lead time, 5 weeks when the camp starts in Jun-Aug. */
export function landeskartenLeadDays(start: IsoDate): number {
  const month = Number(start.slice(5, 7))
  return month >= 6 && month <= 8 ? 35 : 21
}

export const LEIHMATERIAL_LEAD_DAYS = 35
export const NDS_REGISTRATION_LEAD_DAYS = 30
export const NDS_CLOSING_DAYS = 30
export const BEWILLIGUNG_LEAD_DAYS = 21

export type DeadlineStatus = 'done' | 'overdue' | 'soon' | 'open'

/** Status of a deadline relative to `today` ('soon' = due within 14 days). */
export function deadlineStatus(deadline: Pick<Deadline, 'due' | 'done'>, today: IsoDate): DeadlineStatus {
  if (deadline.done) return 'done'
  const left = daysBetween(today, deadline.due)
  if (left < 0) return 'overdue'
  return left <= 14 ? 'soon' : 'open'
}

/** All deadlines of several camps, sorted by due date (then camp title, then kind). */
export function computeAllDeadlines(camps: DeadlineCamp[], inputsByCamp: Record<Iri, CoachInputs | undefined>): Deadline[] {
  return camps
    .flatMap((c) => computeDeadlines(c, inputsByCamp[c.iri] ?? null))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.campTitle.localeCompare(b.campTitle) || a.kind.localeCompare(b.kind)))
}

export function computeDeadlines(camp: DeadlineCamp, inputs: CoachInputs | null): Deadline[] {
  if (!camp.start) return []
  const base = { campIri: camp.iri, campTitle: camp.title }
  const out: Deadline[] = []
  const push = (kind: DeadlineKind, due: IsoDate, done: boolean, ruleId: string | null, source: Source) =>
    out.push({ ...base, kind, due, done, ruleId, source })

  push('nds-registration', addDays(camp.start, -NDS_REGISTRATION_LEAD_DAYS), inputs?.ndsRegistered ?? false, 'JS-DL-01', SOURCE_JS_LAGER)
  const lastJs = camp.lastJsDate ?? camp.end ?? camp.start
  push('nds-closing', addDays(lastJs, NDS_CLOSING_DAYS), inputs?.ndsClosed ?? false, 'JS-DL-02', SOURCE_JS_LAGER)
  push('leihmaterial', addDays(camp.start, -LEIHMATERIAL_LEAD_DAYS), inputs?.leihmaterialOrdered ?? false, 'JS-DL-03', SOURCE_JS_LAGER)
  push(
    'landeskarten',
    addDays(camp.start, -landeskartenLeadDays(camp.start)),
    inputs?.landeskartenOrdered ?? false,
    'JS-DL-03',
    SOURCE_JS_LAGER,
  )
  push('lagerbewilligung', addDays(camp.start, -BEWILLIGUNG_LEAD_DAYS), inputs?.lagerbewilligungDone ?? false, null, SOURCE_COACH)
  return out
}

/** Adds calendar months to a `YYYY-MM-DD` date; the day is clamped to the target month's length. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

/** A camp is archived (deadlines hidden / treated as done) once it ended more than one calendar month ago. */
export function isArchivedCamp(campEnd: IsoDate | null | undefined, today: IsoDate): boolean {
  if (!campEnd) return false
  return today > addMonths(campEnd, 1)
}

/** Marks the deadlines of archived camps as done (`archived: true`). Pure; nothing is persisted. */
export function archiveDeadlines(deadlines: Deadline[], campEndByIri: Record<Iri, IsoDate | null | undefined>, today: IsoDate): Deadline[] {
  return deadlines.map((d) => (isArchivedCamp(campEndByIri[d.campIri], today) ? { ...d, done: true, archived: true } : d))
}

export interface DeadlineFilter {
  /** Empty = all camps. */
  campIris: Iri[]
  /** Empty = all kinds. */
  kinds: DeadlineKind[]
  /** Empty = all statuses. */
  statuses: DeadlineStatus[]
}

/** Filters deadlines by camp, kind and status (each empty list means "no restriction"). */
export function filterDeadlines<T extends Deadline>(deadlines: T[], filter: DeadlineFilter, today: IsoDate): T[] {
  return deadlines.filter(
    (d) =>
      (!filter.campIris.length || filter.campIris.includes(d.campIri)) &&
      (!filter.kinds.length || filter.kinds.includes(d.kind)) &&
      (!filter.statuses.length || filter.statuses.includes(deadlineStatus(d, today))),
  )
}
