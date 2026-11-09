/**
 * Deadlines across camps. Pure.
 * NDS registration T-30 (JS-DL-01), NDS closing T+30 after last J+S activity (JS-DL-02),
 * Leihmaterial T-5w, Landeskarten T-3w (T-5w when the camp starts in Jun-Aug) (JS-DL-03),
 * Lagerbewilligung T-21.
 */
import type { CoachInputs, Deadline, DeadlineKind, Iri, IsoDate, Source } from '../../types'

export interface DeadlineCamp {
  iri: Iri
  title: string
  start: IsoDate | null
  end: IsoDate | null
  /** Date of the last J+S unit if known (from CampFacts), else camp end is used. */
  lastJsDate?: IsoDate | null
  /** Coach-entered last activity date (campRuleConfig.angebot.lastActivityDate); wins over lastJsDate. */
  lastActivityDate?: IsoDate | null
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

/** Lead times in days (defaults = today's values; rules pass the camp's params, see leadTimesFromParams). */
export interface DeadlineLeadTimes {
  ndsRegistration: number
  ndsClosing: number
  leihmaterial: number
  landeskarten: number
  landeskartenSummer: number
  landeskartenSummerMonths: number[]
  /** «soon» window of deadlineStatus / hints. */
  soonDays: number
}

export const DEFAULT_LEAD_TIMES: DeadlineLeadTimes = {
  ndsRegistration: 30,
  ndsClosing: 30,
  leihmaterial: 35,
  landeskarten: 21,
  landeskartenSummer: 35,
  landeskartenSummerMonths: [6, 7, 8],
  soonDays: 14,
}

/** Lead times of a camp from its params (js.ndsRegistrationLeadDays, …). */
export function leadTimesFromParams(params: { get<T>(key: string): T }): DeadlineLeadTimes {
  return {
    ndsRegistration: params.get<number>('js.ndsRegistrationLeadDays'),
    ndsClosing: params.get<number>('js.ndsClosingDays'),
    leihmaterial: params.get<number>('js.leihmaterialLeadDays'),
    landeskarten: params.get<number>('js.landeskartenLeadDays'),
    landeskartenSummer: params.get<number>('js.landeskartenLeadDaysSummer'),
    landeskartenSummerMonths: params.get<number[]>('js.landeskartenSummerMonths'),
    soonDays: params.get<number>('js.deadlineSoonDays'),
  }
}

/** Landeskarten need 3 weeks lead time, 5 weeks when the camp starts in Jun-Aug. */
export function landeskartenLeadDays(start: IsoDate, lead: DeadlineLeadTimes = DEFAULT_LEAD_TIMES): number {
  const month = Number(start.slice(5, 7))
  return lead.landeskartenSummerMonths.includes(month) ? lead.landeskartenSummer : lead.landeskarten
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

export function computeDeadlines(camp: DeadlineCamp, inputs: CoachInputs | null, lead: DeadlineLeadTimes = DEFAULT_LEAD_TIMES): Deadline[] {
  if (!camp.start) return []
  const base = { campIri: camp.iri, campTitle: camp.title }
  const out: Deadline[] = []
  const push = (kind: DeadlineKind, due: IsoDate, done: boolean, ruleId: string | null, source: Source) =>
    out.push({ ...base, kind, due, done, ruleId, source })

  push('nds-registration', addDays(camp.start, -lead.ndsRegistration), inputs?.ndsRegistered ?? false, 'JS-DL-01', SOURCE_JS_LAGER)
  const lastJs = camp.lastActivityDate ?? camp.lastJsDate ?? camp.end ?? camp.start
  push('nds-closing', addDays(lastJs, lead.ndsClosing), inputs?.ndsClosed ?? false, 'JS-DL-02', SOURCE_JS_LAGER)
  // JS-DL-03: lead times count back from the delivery date when the coach entered one, else from the camp start.
  const leihAnchor = inputs?.leihmaterialDeliveryDate ?? camp.start
  const kartenAnchor = inputs?.landeskartenDeliveryDate ?? camp.start
  push('leihmaterial', addDays(leihAnchor, -lead.leihmaterial), inputs?.leihmaterialOrdered ?? false, 'JS-DL-03', SOURCE_JS_LAGER)
  push(
    'landeskarten',
    addDays(kartenAnchor, -landeskartenLeadDays(kartenAnchor, lead)),
    inputs?.landeskartenOrdered ?? false,
    'JS-DL-03',
    SOURCE_JS_LAGER,
  )
  push('lagerbewilligung', addDays(camp.start, -BEWILLIGUNG_LEAD_DAYS), inputs?.lagerbewilligungDone ?? false, null, SOURCE_COACH)
  return out
}
