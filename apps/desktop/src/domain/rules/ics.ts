/**
 * ICS (RFC 5545) export of deadlines. Pure.
 * - One all-day VEVENT per deadline (DTSTART;VALUE=DATE, DTEND = next day), CRLF line endings,
 *   lines folded at 75 octets, text escaped (backslash, semicolon, comma, newline).
 * - UID stable across exports: `${campId}-${kind}[-${milestoneId}]@co-co` so calendars update instead
 *   of duplicating.
 * - SUMMARY: «<camp title>: <deadline title>», DESCRIPTION incl. source URL, URL property = source URL.
 * - Optional VALARM (DISPLAY) `alarmDaysBefore` days before (default 3; null = no alarm).
 * - Done deadlines are skipped unless includeDone.
 */
import type { Deadline } from '../types'

export interface IcsOptions {
  /** Title per deadline (UI passes the translated kind title; milestones use deadline.title). */
  titleOf: (d: Deadline) => string
  now: Date
  includeDone?: boolean
  alarmDaysBefore?: number | null
  calendarName?: string
}

export function toIcs(deadlines: Deadline[], opts: IcsOptions): string {
  void [deadlines, opts]
  throw new Error('not implemented')
}
